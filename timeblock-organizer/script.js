/* timeblock-organizer v1.0.0
 *
 * Watches daily pages and reorganizes time-prefixed TODOs into the
 * #TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs))}} parent
 * block, sorted by start-time ascending. Pins the SmartBlock timestamp
 * button block (`{{🕗↦:SmartBlock:Double timestamp buttons2}}`) as the
 * last child. Fixes any scheduling tool — Chief of Staff, manual edits,
 * Better Tasks dropdowns, future skills — without coupling to any
 * specific writer.
 *
 * Bug it solves: when COS (or any tool) writes a `14:00 - 15:00 {{[[TODO]]}}
 * foo` block to today's daily page as a direct page-level child, this
 * plugin's pull-watch fires, the block gets moved under TimeBlock at the
 * right time-sorted position, the SmartBlock button stays pinned at the
 * end, and the daily page stays clean.
 *
 * No LLM call. Pure Roam datalog + block.move. Cost: $0.
 *
 * Phase 1 scope (this version):
 *   - Pull-watch on today + tomorrow daily pages
 *   - Lazy-watch when user navigates to historical daily pages within
 *     the configured window (default 7 days back)
 *   - LRU-capped active watches (default 14)
 *   - Date rollover detection (60s setInterval registers new today)
 *   - Periodic 5-min reconcile sweep covers `block.update` events that
 *     pull-watch on `:block/children` doesn't fire for
 *   - Idempotent reconcile (no-op when already organized)
 *   - Suppress self-triggered watch fires for 2s after our own moves
 *
 * Phase 2 (future): conflict detection — flag overlapping time ranges
 *   into a status block on the daily page. See SETTINGS-PAGE-ROLLOUT.md.
 *
 * Phase 3 (future): smart re-shuffle — bump conflicting items forward
 *   by overlap, cascade up to a cutoff time. Opt-in.
 */
;(function () {
  const VERSION = "1.0.0";
  const NAMESPACE = "timeblock-organizer";
  const SETTINGS_PAGE = "TimeBlock Organizer Settings";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 8000,                      // coalesce burst writes
    historicalWindowDays: 7,               // how far back to auto-watch on navigation
    maxActiveWatches: 14,                  // LRU cap
    timeblockSignature: "#TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs))",
    smartblockButtonSignature: "{{🕗↦:SmartBlock:Double timestamp buttons2}}",
    sweepIntervalMs: 5 * 60_000,           // periodic reconcile in case watches miss edits
    rolloverCheckMs: 60_000,               // how often to check for date rollover
    suppressMs: 2000,                      // ignore watch fires from our own writes
    dryRun: false,                         // log moves without executing
    verbose: false,
  };

  const state = {
    settings: { ...DEFAULTS },
    activeWatches: new Map(),              // pageUid → { unsub, lastUsed }
    pendingReconciles: new Map(),          // pageUid → debounce timer
    suppressUntil: 0,                      // ms timestamp; ignore watches before this
    sweepTimer: null,
    rolloverTimer: null,
    cachedTodayUid: null,
    navigationListenerAttached: false,
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;
  const debug = (msg, data) => { if (state.settings.verbose) log("debug", msg, data); };

  /* ---------- Settings ---------- */
  const GRAPH_SETTINGS = [
    ["enabled",                     "enabled",                   "bool",   true,
      "Master switch. false = no watches, no reconciles, the plugin is dormant."],
    ["debounce_ms",                 "debounceMs",                "int",    8000,
      "ms to wait after a daily-page change before reconciling. Coalesces burst writes from COS / Better Tasks."],
    ["historical_window_days",      "historicalWindowDays",      "int",    7,
      "How many days back to auto-register watches when you navigate to a historical daily page. 0 = today + tomorrow only."],
    ["max_active_watches",          "maxActiveWatches",          "int",    14,
      "Cap on simultaneously-watched daily pages. LRU evicts when exceeded."],
    ["timeblock_signature",         "timeblockSignature",        "string", DEFAULTS.timeblockSignature,
      "Prefix that identifies the Nautilus TimeBlock parent block. The plugin finds the FIRST block on a daily page whose string starts with this."],
    ["smartblock_button_signature", "smartblockButtonSignature", "string", DEFAULTS.smartblockButtonSignature,
      "Exact string of the SmartBlock timestamp-button block that must always be the last child of TimeBlock. If you renamed it, paste the new exact string here."],
    ["sweep_interval_ms",           "sweepIntervalMs",           "int",    300000,
      "Periodic reconcile sweep over all watched pages. Catches edits that pull-watch on :block/children misses (e.g. text-only changes that add a time prefix)."],
    ["rollover_check_ms",           "rolloverCheckMs",           "int",    60000,
      "How often to check whether the date has rolled over (so today's daily page changes uid)."],
    ["suppress_ms",                 "suppressMs",                "int",    2000,
      "After we issue our own block.move calls, ignore watch callbacks for this many ms (avoids self-triggered loops)."],
    ["dry_run",                     "dryRun",                    "bool",   false,
      "Log every move that WOULD be executed, without actually moving blocks. Useful for previewing behavior."],
    ["verbose",                     "verbose",                   "bool",   false,
      "Verbose console logging. Off by default — most operations are silent."],
  ];

  // === SETTINGS-PAGE LIB START v1.0.0 === (synced from _lib/settings-page.js)
  //
  // Source of truth for the [[<Plugin> Settings]] page pattern. Inlined into
  // each plugin's script.js between the START/END markers via
  // `bash sync-settings-lib.sh`. To update the helpers across all plugins:
  //
  //   1. Edit this file
  //   2. Run `bash sync-settings-lib.sh` from the repo root
  //   3. Commit + push (each plugin's script.js bytes change)
  //
  // Usage inside a plugin's IIFE:
  //
  //   const settingsMgr = createSettingsManager({
  //     SETTINGS_PAGE,         // e.g. "Auto-Attribute Settings"
  //     GRAPH_SETTINGS,        // [[graphKey, settingsKey, type, default, description], ...]
  //     settingsRef: state.settings,
  //     log,                   // function(level, msg, data)
  //     sk: (k) => `${NAMESPACE}:${k}`,
  //   });
  //   const {
  //     loadPersistentSettings, persistSettings,
  //     loadAllSettingsFromGraph, persistSettingToGraph, ensureSettingsPage,
  //   } = settingsMgr;
  //
  // The factory returns standalone functions that share access to `ctx` via
  // closure — same behavior as the previous inline duplicated code. Drop-in
  // replacement; existing call sites keep working.
  function createSettingsManager(ctx) {
    const { SETTINGS_PAGE, GRAPH_SETTINGS, settingsRef, log, sk } = ctx;
  
    function parseSettingValue(type, raw) {
      if (raw == null) return null;
      const s = String(raw).trim();
      if (type === "bool") {
        const lower = s.toLowerCase();
        return lower === "true" || lower === "yes" || lower === "on" || lower === "1" || lower === "y";
      }
      if (type === "int") { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
      if (type === "float") { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }
      return s;
    }
  
    function formatSettingValue(type, value) {
      if (type === "bool") return value ? "true" : "false";
      return String(value);
    }
  
    function loadPersistentSettings() {
      try {
        const raw = localStorage.getItem(sk("settings"));
        if (!raw) return;
        const stored = JSON.parse(raw);
        for (const [, settingsKey] of GRAPH_SETTINGS) {
          if (stored[settingsKey] !== undefined) settingsRef[settingsKey] = stored[settingsKey];
        }
      } catch (e) { log("warn", "loadPersistentSettings failed", e); }
    }
  
    function persistSettings() {
      try {
        const obj = {};
        for (const [, settingsKey] of GRAPH_SETTINGS) obj[settingsKey] = settingsRef[settingsKey];
        localStorage.setItem(sk("settings"), JSON.stringify(obj));
      } catch (e) { log("warn", "persistSettings failed", e); }
    }
  
    function loadAllSettingsFromGraph() {
      try {
        const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?s :where [?p :node/title "${safeName}"] [?b :block/page ?p] [?b :block/string ?s]]
        `);
        const blocksByKey = {};
        for (const r of rows) {
          const s = (r[0] || "").trim();
          const m = s.match(/^([a-z_][a-z0-9_]*)::\s*(.*)$/i);
          if (m) blocksByKey[m[1]] = m[2];
        }
        let updated = 0;
        for (const [graphKey, settingsKey, type] of GRAPH_SETTINGS) {
          if (!(graphKey in blocksByKey)) continue;
          const raw = blocksByKey[graphKey];
          if (graphKey === "gemini_api_key" && (raw === "" || raw === "PASTE_YOUR_KEY_HERE")) continue;
          const parsed = parseSettingValue(type, raw);
          if (parsed === null) continue;
          if (settingsRef[settingsKey] === parsed) continue;
          settingsRef[settingsKey] = parsed;
          updated++;
        }
        if (updated > 0) {
          persistSettings();
          log("info", `loaded ${updated} setting(s) from [[${SETTINGS_PAGE}]]`);
        }
        return updated;
      } catch (e) { log("debug", "loadAllSettingsFromGraph failed", e); return 0; }
    }
  
    async function ensureSettingsBlock(pageUid, graphKey, type, currentValue, description, order) {
      const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?u :where [?p :node/title "${safeName}"] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [(clojure.string/starts-with? ?s "${graphKey}::")]]
      `);
      let blockUid = rows?.[0]?.[0];
      if (blockUid) return blockUid;
      blockUid = window.roamAlphaAPI.util.generateUID();
      const placeholder = (graphKey === "gemini_api_key" && !currentValue) ? "PASTE_YOUR_KEY_HERE" : formatSettingValue(type, currentValue);
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": pageUid, order },
        block: { uid: blockUid, string: `${graphKey}:: ${placeholder}` },
      });
      const descUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": blockUid, order: 0 },
        block: { uid: descUid, string: description },
      });
      return blockUid;
    }
  
    async function persistSettingToGraph(graphKey) {
      const row = GRAPH_SETTINGS.find(r => r[0] === graphKey);
      if (!row) return;
      const [, settingsKey, type] = row;
      const value = settingsRef[settingsKey];
      const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
      try {
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?u :where [?p :node/title "${safeName}"] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [(clojure.string/starts-with? ?s "${graphKey}::")]]
        `);
        const blockUid = rows?.[0]?.[0];
        if (!blockUid) return;
        await window.roamAlphaAPI.data.block.update({
          block: { uid: blockUid, string: `${graphKey}:: ${formatSettingValue(type, value)}` },
        });
      } catch (e) { log("debug", `persistSettingToGraph(${graphKey}) failed`, e?.message || e); }
    }
  
    async function ensureSettingsPage(openInSidebar = true) {
      const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
      let pageUid;
      try {
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?u :where [?p :node/title "${safeName}"] [?p :block/uid ?u]]
        `);
        pageUid = rows?.[0]?.[0];
      } catch {}
      if (!pageUid) {
        pageUid = window.roamAlphaAPI.util.generateUID();
        await window.roamAlphaAPI.data.page.create({ page: { title: SETTINGS_PAGE, uid: pageUid } });
      }
      const headerRows = window.roamAlphaAPI.data.q(`
        [:find ?u :where [?p :node/title "${safeName}"] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [(clojure.string/starts-with? ?s "**How to use this page**")]]
      `);
      if (!headerRows?.[0]?.[0]) {
        const headerUid = window.roamAlphaAPI.util.generateUID();
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": pageUid, order: 0 },
          block: { uid: headerUid, string: "**How to use this page** — every setting below is `key:: value`. Edit the value inline (click the block, change the text, click out). The script reloads from this page on each scan cycle, or instantly via the matching cmd palette \"reload settings from graph\" command. Bool keys: `true` or `false`. Numbers as plain digits." },
        });
      }
      let order = 1;
      for (const [graphKey, settingsKey, type, , description] of GRAPH_SETTINGS) {
        await ensureSettingsBlock(pageUid, graphKey, type, settingsRef[settingsKey], description, order);
        order++;
      }
      if (openInSidebar) {
        try { await window.roamAlphaAPI.ui.rightSidebar.addWindow({ window: { type: "outline", "block-uid": pageUid } }); }
        catch (e) {
          try { await window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: pageUid } }); } catch {}
        }
      }
      return pageUid;
    }
  
    return {
      parseSettingValue, formatSettingValue,
      loadPersistentSettings, persistSettings,
      loadAllSettingsFromGraph, ensureSettingsBlock,
      persistSettingToGraph, ensureSettingsPage,
    };
  }
  // === SETTINGS-PAGE LIB END v1.0.0 ===

  const _settingsMgr = createSettingsManager({
    SETTINGS_PAGE, GRAPH_SETTINGS,
    settingsRef: state.settings,
    log,
    sk,
  });
  const {
    loadPersistentSettings, persistSettings,
    loadAllSettingsFromGraph, persistSettingToGraph, ensureSettingsPage,
  } = _settingsMgr;

  /* ---------- Roam helpers ---------- */
  function todayPageUid() {
    try { return window.roamAlphaAPI.util.dateToPageUid(new Date()); } catch { return null; }
  }
  function tomorrowPageUid() {
    try {
      const t = new Date(); t.setDate(t.getDate() + 1);
      return window.roamAlphaAPI.util.dateToPageUid(t);
    } catch { return null; }
  }
  function offsetPageUid(offsetDays) {
    try {
      const d = new Date(); d.setDate(d.getDate() + offsetDays);
      return window.roamAlphaAPI.util.dateToPageUid(d);
    } catch { return null; }
  }

  function getDirectChildren(parentUid) {
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid :block/string :block/order]}]",
        [":block/uid", parentUid]
      );
      const children = (data?.[":block/children"] || [])
        .map(c => ({
          uid: c[":block/uid"],
          string: c[":block/string"] || "",
          order: c[":block/order"] || 0,
        }))
        .sort((a, b) => a.order - b.order);
      return children;
    } catch (e) {
      debug("getDirectChildren failed", { parentUid, err: e?.message || e });
      return [];
    }
  }

  function findTimeBlockUid(dailyPageUid) {
    const sig = state.settings.timeblockSignature;
    const children = getDirectChildren(dailyPageUid);
    for (const c of children) {
      if (c.string.startsWith(sig)) return c.uid;
    }
    return null;
  }

  /* ---------- parsing ---------- */
  // Match: HH:MM - HH:MM {{[[TODO]]}} ...    or    HH:MM - HH:MM {{[[DONE]]}} ...
  // Also tolerate optional whitespace and en-dash.
  const TIME_PREFIX_RE = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s+\{\{\[\[(?:TODO|DONE)\]\]\}\}/;

  function parseTimePrefix(blockString) {
    if (!blockString) return null;
    const m = blockString.match(TIME_PREFIX_RE);
    if (!m) return null;
    const sh = parseInt(m[1], 10), sm = parseInt(m[2], 10);
    const eh = parseInt(m[3], 10), em = parseInt(m[4], 10);
    if (sh > 23 || sm > 59 || eh > 23 || em > 59) return null;
    return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
  }

  function isTimePrefixed(s) {
    return parseTimePrefix(s) !== null;
  }

  function isSmartBlockButton(s) {
    return s === state.settings.smartblockButtonSignature;
  }

  /* ---------- the core: reconcile ---------- */
  /**
   * Compute desired order for TimeBlock children:
   *   [time-prefixed TODOs sorted by startMin asc, ..., SmartBlock button(s) last]
   *
   * Items already under TimeBlock that AREN'T time-prefixed AND aren't the
   * SmartBlock button stay where they are (we don't reorder them).
   *
   * Items at the daily-page level that ARE time-prefixed get pulled into
   * TimeBlock at the right position.
   */
  function computeDesiredOrder(pageUid, tbUid) {
    const pageChildren = getDirectChildren(pageUid);
    const tbChildren = getDirectChildren(tbUid);

    const pageLevelMisplaced = pageChildren.filter(c =>
      c.uid !== tbUid && isTimePrefixed(c.string)
    );

    const tbTimePrefixed = tbChildren.filter(c => isTimePrefixed(c.string));
    const tbButtons = tbChildren.filter(c => isSmartBlockButton(c.string));
    const tbOther = tbChildren.filter(c =>
      !isTimePrefixed(c.string) && !isSmartBlockButton(c.string)
    );

    const allTodos = [...tbTimePrefixed, ...pageLevelMisplaced];
    allTodos.sort((a, b) => {
      const at = parseTimePrefix(a.string).startMin;
      const bt = parseTimePrefix(b.string).startMin;
      return at - bt;
    });

    // Final desired sequence: tbOther (untouched, in their existing order),
    // then sorted TODOs, then SmartBlock button(s).
    return {
      desired: [...tbOther, ...allTodos, ...tbButtons],
      pageLevelMisplaced,
      currentTbChildren: tbChildren,
    };
  }

  function isAlreadyOrganized(desired, currentTbChildren, pageLevelMisplaced) {
    if (pageLevelMisplaced.length > 0) return false;
    if (currentTbChildren.length !== desired.length) return false;
    for (let i = 0; i < desired.length; i++) {
      if (currentTbChildren[i].uid !== desired[i].uid) return false;
    }
    return true;
  }

  async function reconcileTimeBlock(pageUid, reason = "watch") {
    if (!state.settings.enabled) return;
    const tbUid = findTimeBlockUid(pageUid);
    if (!tbUid) {
      debug(`no TimeBlock parent on page ${pageUid} — skip`);
      return;
    }
    const { desired, pageLevelMisplaced, currentTbChildren } = computeDesiredOrder(pageUid, tbUid);

    if (isAlreadyOrganized(desired, currentTbChildren, pageLevelMisplaced)) {
      debug(`page ${pageUid} already organized (${desired.length} children)`);
      return;
    }

    const moveCount = pageLevelMisplaced.length + desired.filter((d, i) =>
      currentTbChildren[i]?.uid !== d.uid
    ).length;
    log("info", `reconciling TimeBlock on ${pageUid} (${reason}): ${pageLevelMisplaced.length} pulled in + reorder, ${moveCount} block.moves`);

    if (state.settings.dryRun) {
      log("info", `[dry-run] would move into order:`, desired.map(d => ({
        uid: d.uid,
        preview: d.string.slice(0, 50),
      })));
      return;
    }

    state.suppressUntil = Date.now() + state.settings.suppressMs;
    const api = window.roamAlphaAPI.data.block;
    let executed = 0, failed = 0;
    for (const item of desired) {
      try {
        await api.move({
          location: { "parent-uid": tbUid, order: "last" },
          block: { uid: item.uid },
        });
        executed++;
      } catch (e) {
        log("warn", `move failed for ${item.uid}`, e?.message || e);
        failed++;
      }
    }
    if (failed > 0) log("warn", `reconcile complete with ${failed} failures (${executed} ok)`);
  }

  function scheduleReconcile(pageUid, reason) {
    if (state.pendingReconciles.has(pageUid)) {
      clearTimeout(state.pendingReconciles.get(pageUid));
    }
    const t = setTimeout(() => {
      state.pendingReconciles.delete(pageUid);
      reconcileTimeBlock(pageUid, reason).catch(e =>
        log("warn", `reconcile threw on ${pageUid}`, e?.message || e)
      );
    }, state.settings.debounceMs);
    state.pendingReconciles.set(pageUid, t);
  }

  /* ---------- watches ---------- */
  function registerWatch(pageUid, reason) {
    if (state.activeWatches.has(pageUid)) {
      const w = state.activeWatches.get(pageUid);
      w.lastUsed = Date.now();
      return;
    }
    if (state.activeWatches.size >= state.settings.maxActiveWatches) {
      // Evict LRU
      let oldestUid = null, oldestTs = Infinity;
      for (const [uid, w] of state.activeWatches) {
        if (w.lastUsed < oldestTs) { oldestTs = w.lastUsed; oldestUid = uid; }
      }
      if (oldestUid) {
        try { state.activeWatches.get(oldestUid).unsub(); } catch {}
        state.activeWatches.delete(oldestUid);
        debug(`LRU evicted watch on ${oldestUid}`);
      }
    }
    const cb = () => {
      if (Date.now() < state.suppressUntil) {
        debug(`watch on ${pageUid} fired but suppressed (self-triggered)`);
        return;
      }
      scheduleReconcile(pageUid, "watch");
    };
    try {
      window.roamAlphaAPI.data.addPullWatch(
        "[{:block/children [:block/uid :block/string :block/order]}]",
        [":block/uid", pageUid],
        cb
      );
      state.activeWatches.set(pageUid, {
        unsub: () => {
          try {
            window.roamAlphaAPI.data.removePullWatch(
              "[{:block/children [:block/uid :block/string :block/order]}]",
              [":block/uid", pageUid],
              cb
            );
          } catch {}
        },
        lastUsed: Date.now(),
        registeredAt: Date.now(),
      });
      debug(`registered watch on ${pageUid} (${reason}) — ${state.activeWatches.size} active`);
      // Reconcile once on registration to clean up any pre-existing mess
      scheduleReconcile(pageUid, `${reason}-initial`);
    } catch (e) {
      log("warn", `addPullWatch failed for ${pageUid}`, e?.message || e);
    }
  }

  function unregisterWatch(pageUid) {
    const w = state.activeWatches.get(pageUid);
    if (!w) return;
    try { w.unsub(); } catch {}
    state.activeWatches.delete(pageUid);
    if (state.pendingReconciles.has(pageUid)) {
      clearTimeout(state.pendingReconciles.get(pageUid));
      state.pendingReconciles.delete(pageUid);
    }
    debug(`unregistered watch on ${pageUid}`);
  }

  /* ---------- timers: rollover + sweep ---------- */
  function checkRollover() {
    const newToday = todayPageUid();
    if (!newToday) return;
    if (newToday === state.cachedTodayUid) return;
    log("info", `date rollover detected: ${state.cachedTodayUid} → ${newToday}`);
    state.cachedTodayUid = newToday;
    registerWatch(newToday, "rollover-today");
    const newTomorrow = tomorrowPageUid();
    if (newTomorrow) registerWatch(newTomorrow, "rollover-tomorrow");
  }

  async function periodicSweep() {
    if (!state.settings.enabled) return;
    debug(`periodic sweep over ${state.activeWatches.size} watched pages`);
    for (const [pageUid] of state.activeWatches) {
      try { await reconcileTimeBlock(pageUid, "sweep"); }
      catch (e) { debug(`sweep reconcile failed on ${pageUid}`, e?.message || e); }
    }
  }

  /* ---------- navigation listener ---------- */
  function onPageNavigation() {
    if (!state.settings.enabled) return;
    let openUid;
    try { openUid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); }
    catch { return; }
    if (!openUid) return;
    // Is it a daily page within window?
    const window_ = state.settings.historicalWindowDays;
    for (let i = -window_; i <= 1; i++) {
      if (openUid === offsetPageUid(i)) {
        registerWatch(openUid, `nav-${i}`);
        return;
      }
    }
  }

  function attachNavigationListener() {
    if (state.navigationListenerAttached) return;
    // Roam doesn't expose a clean event for page navigation in its public API.
    // Listen for hash changes (Roam routes via `/page/<uid>` in the hash) and
    // also do a low-frequency check from the rollover timer.
    const handler = () => onPageNavigation();
    window.addEventListener("hashchange", handler);
    state._navHandler = handler;
    state.navigationListenerAttached = true;
  }

  function detachNavigationListener() {
    if (!state.navigationListenerAttached) return;
    if (state._navHandler) {
      try { window.removeEventListener("hashchange", state._navHandler); } catch {}
      state._navHandler = null;
    }
    state.navigationListenerAttached = false;
  }

  /* ---------- commands ---------- */
  function registerCommands() {
    const add = (label, callback) => {
      try { window.roamAlphaAPI.ui.commandPalette.removeCommand({ label }); } catch {}
      try {
        window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback });
        state.registeredCommandLabels.add(label);
      } catch (e) { log("warn", `add cmd failed: ${label}`, e); }
    };

    const toggleSetting = (graphKey, settingsKey, descriptor) => async () => {
      state.settings[settingsKey] = !state.settings[settingsKey];
      persistSettings();
      await persistSettingToGraph(graphKey);
      log("info", `${descriptor}: ${state.settings[settingsKey] ? "ON" : "OFF"}`);
    };

    add("TimeBlock Organizer: open settings page (edit toggles inline)", async () => {
      try { await ensureSettingsPage(true); log("info", "Settings page opened in right sidebar"); }
      catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("TimeBlock Organizer: reload settings from graph", () => {
      const u = loadAllSettingsFromGraph();
      log("info", u > 0 ? `${u} setting(s) reloaded` : "no setting changes detected");
    });
    add("TimeBlock Organizer: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("TimeBlock Organizer: toggle dry-run mode", toggleSetting("dry_run", "dryRun", "dryRun"));
    add("TimeBlock Organizer: toggle verbose logging", toggleSetting("verbose", "verbose", "verbose"));
    add("TimeBlock Organizer: reconcile current page now", async () => {
      let openUid;
      try { openUid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); }
      catch {}
      if (!openUid) return log("warn", "no open page detected");
      await reconcileTimeBlock(openUid, "manual");
    });
    add("TimeBlock Organizer: reconcile today + tomorrow", async () => {
      const today = todayPageUid();
      const tomorrow = tomorrowPageUid();
      if (today) await reconcileTimeBlock(today, "manual-today");
      if (tomorrow) await reconcileTimeBlock(tomorrow, "manual-tomorrow");
    });
    add("TimeBlock Organizer: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `timeblock-organizer v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.dryRun)} dry-run mode`,
        `  ${onOff(state.settings.verbose)} verbose logging`,
        ``,
        `── runtime ──`,
        `  Active watches: ${state.activeWatches.size} / ${state.settings.maxActiveWatches}`,
        `  Pending reconciles: ${state.pendingReconciles.size}`,
        `  Today UID: ${state.cachedTodayUid || "(none)"}`,
        `  TimeBlock signature: ${state.settings.timeblockSignature.slice(0, 60)}...`,
        `  SmartBlock button: ${state.settings.smartblockButtonSignature}`,
        `  Debounce: ${state.settings.debounceMs}ms / sweep: ${state.settings.sweepIntervalMs / 60000}min`,
        ``,
        `Watched pages:`,
        ...Array.from(state.activeWatches.entries()).map(([uid, w]) =>
          `  - ${uid} (last used ${Math.round((Date.now() - w.lastUsed) / 1000)}s ago)`
        ),
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });
    add("TimeBlock Organizer: list active watches (debug)", () => {
      console.table(Array.from(state.activeWatches.entries()).map(([uid, w]) => ({
        page_uid: uid,
        registered_at: new Date(w.registeredAt).toLocaleString(),
        last_used_sec_ago: Math.round((Date.now() - w.lastUsed) / 1000),
      })));
    });
  }

  /* ---------- init / cleanup ---------- */
  function init() {
    log("info", `v${VERSION} starting`);
    const priorCleanup = window[`${NAMESPACE}_cleanup`];
    if (typeof priorCleanup === "function") {
      try { priorCleanup(); log("info", "cleaned up prior version"); }
      catch (e) { log("warn", "prior cleanup threw", e?.message || e); }
    }
    loadPersistentSettings();
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      .catch(e => log("warn", "settings page bootstrap failed", e?.message || e));
    registerCommands();

    if (state.settings.enabled) {
      state.cachedTodayUid = todayPageUid();
      if (state.cachedTodayUid) registerWatch(state.cachedTodayUid, "init-today");
      const tomorrow = tomorrowPageUid();
      if (tomorrow) registerWatch(tomorrow, "init-tomorrow");
      attachNavigationListener();
      state.rolloverTimer = setInterval(checkRollover, state.settings.rolloverCheckMs);
      state.sweepTimer = setInterval(() => {
        periodicSweep().catch(e => log("warn", "sweep threw", e?.message || e));
      }, state.settings.sweepIntervalMs);
    } else {
      log("warn", "enabled=false — running in dormant mode (no watches, no reconciles)");
    }

    window[`${NAMESPACE}_state`] = state;
    log("info", `ready. ${state.activeWatches.size} watches active.`);
  }

  function cleanup() {
    if (state.rolloverTimer) clearInterval(state.rolloverTimer);
    if (state.sweepTimer) clearInterval(state.sweepTimer);
    for (const t of state.pendingReconciles.values()) clearTimeout(t);
    state.pendingReconciles.clear();
    for (const [uid, w] of state.activeWatches) {
      try { w.unsub(); } catch {}
    }
    state.activeWatches.clear();
    detachNavigationListener();
    if (state.registeredCommandLabels) {
      for (const label of state.registeredCommandLabels) {
        try { window.roamAlphaAPI.ui.commandPalette.removeCommand({ label }); } catch {}
      }
      state.registeredCommandLabels.clear();
    }
    log("info", "cleaned up");
  }
  window[`${NAMESPACE}_cleanup`] = cleanup;

  init();
})();
