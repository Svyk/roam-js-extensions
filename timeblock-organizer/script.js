/* timeblock-organizer v1.1.0
 *
 * v1.1.0 — Phase 2 + Phase 3 ship.
 *   Phase 2 (conflict detection): after each reconcile, scan the sorted
 *   TimeBlock children for overlapping time ranges. If conflicts exist,
 *   write a `**TimeBlock Conflicts** (N) #timeblock-status` block as the
 *   LAST child of the daily page with one bullet per overlapping pair
 *   (e.g. `09:00-10:00 "EMP review" overlaps 09:30-10:30 "swab walk" —
 *   30min`). Block is auto-deleted when zero conflicts remain. Always-on
 *   console warning regardless of status-block setting.
 *   Phase 3 (auto-resolve, opt-in): when `auto_resolve_conflicts` is on
 *   and `conflict_strategy` is `bump_forward`, the script rewrites the
 *   later item's time prefix to start at the earlier item's end, cascading
 *   forward. Refuses (and reports as a dead-end in the status block) if
 *   the cascade pushes past `cascade_cutoff_time` (default 23:00). Items
 *   tagged with `#pinned-time` are skipped (you decided their time
 *   intentionally; we won't move them).
 *
 * v1.0.0 — Phase 1: watches daily pages and reorganizes time-prefixed
 *   TODOs into the #TimeBlock parent, sorted by start-time. Pins the
 *   SmartBlock timestamp button as last child. Pull-watches today +
 *   tomorrow + historically-visited daily pages within a window. LRU-
 *   capped, debounced, idempotent.
 *
 * Bug it solves: when COS (or any tool) writes a `14:00 - 15:00 {{[[TODO]]}}
 * foo` block to today's daily page as a direct page-level child, this
 * plugin's pull-watch fires, the block gets moved under TimeBlock at the
 * right time-sorted position, the SmartBlock button stays pinned at the
 * end, and (v1.1.0) any time conflicts get reported / auto-resolved.
 *
 * No LLM call. Pure Roam datalog + block.move/update. Cost: $0.
 */
;(function () {
  const VERSION = "1.1.0";
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
    // v1.1.0 Phase 2: conflict detection
    conflictDetection: true,               // scan for overlapping ranges after each reconcile
    conflictStatusBlock: true,             // write a status block on the daily page
    // v1.1.0 Phase 3: auto-resolve (opt-in)
    autoResolveConflicts: false,           // off by default — you might WANT overlaps
    conflictStrategy: "bump_forward",      // only one strategy supported for now
    cascadeCutoffTime: "23:00",            // refuse to bump past this (HH:MM)
    pinnedMarker: "#pinned-time",          // items with this tag don't get bumped
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
    // Phase 2: conflict detection
    ["conflict_detection",          "conflictDetection",         "bool",   true,
      "After each reconcile, scan TimeBlock children for overlapping time ranges. Off = no conflict warnings at all."],
    ["conflict_status_block",       "conflictStatusBlock",       "bool",   true,
      "Write a `**TimeBlock Conflicts** (N) #timeblock-status` block on the daily page when overlaps exist. Auto-deleted when zero conflicts. Off = console-only warnings."],
    // Phase 3: auto-resolve
    ["auto_resolve_conflicts",      "autoResolveConflicts",      "bool",   false,
      "Auto-rewrite conflicting time prefixes (bump the later item forward by the overlap). OFF by default — you might intentionally want overlaps. Only takes effect when conflict_detection is also on."],
    ["conflict_strategy",           "conflictStrategy",          "string", "bump_forward",
      "Resolution strategy. Only `bump_forward` supported in v1.1.0 — push the later item's start to the earlier item's end, cascading forward."],
    ["cascade_cutoff_time",         "cascadeCutoffTime",         "string", "23:00",
      "If a cascade would push an item to start past this time (HH:MM, 24h), refuse the resolution and flag the item as a dead-end in the status block. Default 23:00 (no scheduling past 11pm)."],
    ["pinned_marker",               "pinnedMarker",              "string", "#pinned-time",
      "Substring/tag that marks an item as user-pinned. Pinned items are NEVER auto-bumped, even if they're the cause of a cascade dead-end. Add this tag to a TODO to lock its time."],
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

  function isPinned(s) {
    const marker = state.settings.pinnedMarker;
    return marker && s.includes(marker);
  }

  function formatMinAsHHMM(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "00:00";
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function parseCutoffTime(hhmm) {
    if (!hhmm || typeof hhmm !== "string") return 23 * 60;
    const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 23 * 60;
    const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (h > 23 || mm > 59) return 23 * 60;
    return h * 60 + mm;
  }

  /* Replace the leading "HH:MM - HH:MM" in a TODO/DONE block with new times. */
  function rewriteTimePrefix(blockString, newStartMin, newEndMin) {
    const sh = formatMinAsHHMM(newStartMin);
    const eh = formatMinAsHHMM(newEndMin);
    return blockString.replace(TIME_PREFIX_RE, (match) => {
      const markerMatch = match.match(/\{\{\[\[(?:TODO|DONE)\]\]\}\}/);
      const marker = markerMatch ? markerMatch[0] : "{{[[TODO]]}}";
      return `${sh} - ${eh} ${marker}`;
    });
  }

  /* ---------- Phase 2: conflict detection ---------- */
  /**
   * Given items already sorted by startMin asc, return the list of overlapping
   * pairs. Each pair: { a, b, overlapMinutes }. Skips zero-duration items
   * (no time to overlap) and malformed ones (end < start).
   */
  function detectOverlaps(sortedItems) {
    const conflicts = [];
    const parsed = sortedItems
      .map(it => ({ ...it, t: parseTimePrefix(it.string) }))
      .filter(it => it.t && it.t.endMin > it.t.startMin);
    for (let i = 0; i < parsed.length; i++) {
      const a = parsed[i];
      for (let j = i + 1; j < parsed.length; j++) {
        const b = parsed[j];
        if (b.t.startMin >= a.t.endMin) break; // sorted; no further overlaps with a
        const overlapStart = Math.max(a.t.startMin, b.t.startMin);
        const overlapEnd = Math.min(a.t.endMin, b.t.endMin);
        if (overlapEnd > overlapStart) {
          conflicts.push({ a, b, overlapMinutes: overlapEnd - overlapStart });
        }
      }
    }
    return conflicts;
  }

  function shortDescription(blockString) {
    // Strip "HH:MM - HH:MM {{[[TODO/DONE]]}} " prefix; truncate.
    const stripped = blockString.replace(TIME_PREFIX_RE, "").trim();
    if (stripped.length <= 50) return stripped;
    return stripped.slice(0, 47) + "…";
  }

  function timeRangeOf(item) {
    const t = parseTimePrefix(item.string);
    if (!t) return "??:??";
    return `${formatMinAsHHMM(t.startMin)}-${formatMinAsHHMM(t.endMin)}`;
  }

  /* ---------- Phase 3: bump_forward auto-resolve ---------- */
  /**
   * Walk sorted items left-to-right. For each pair where curr.startMin <
   * prev.endMin AND curr is not pinned, rewrite curr's start to prev.endMin
   * (preserving duration). If the new end exceeds cutoff, abort and report
   * the dead-end. Returns { ok, updates, deadEnds }.
   *
   * Note: this is destructive on the input array's `t` field (mutates the
   * working copy). Callers should map item.string updates from `updates`.
   */
  function resolveConflicts(items, cutoffMin) {
    const working = items
      .map(it => ({
        uid: it.uid,
        originalString: it.string,
        currentString: it.string,
        t: parseTimePrefix(it.string),
        pinned: isPinned(it.string),
      }))
      .filter(it => it.t);
    const updates = [];
    const deadEnds = [];

    for (let i = 1; i < working.length; i++) {
      const prev = working[i - 1];
      const curr = working[i];
      if (curr.t.startMin >= prev.t.endMin) continue; // no overlap
      if (curr.pinned) {
        deadEnds.push({
          item: curr,
          reason: `pinned (${state.settings.pinnedMarker}) — refusing to bump`,
        });
        continue;
      }
      const duration = curr.t.endMin - curr.t.startMin;
      const newStart = prev.t.endMin;
      const newEnd = newStart + duration;
      if (newEnd > cutoffMin) {
        deadEnds.push({
          item: curr,
          reason: `cascade past cutoff: would end ${formatMinAsHHMM(newEnd)} > ${formatMinAsHHMM(cutoffMin)}`,
        });
        continue;
      }
      curr.t = { startMin: newStart, endMin: newEnd };
      curr.currentString = rewriteTimePrefix(curr.currentString, newStart, newEnd);
      updates.push({
        uid: curr.uid,
        oldString: curr.originalString,
        newString: curr.currentString,
        bumpedFrom: parseTimePrefix(curr.originalString),
        bumpedTo: { startMin: newStart, endMin: newEnd },
      });
    }
    return { updates, deadEnds };
  }

  /* ---------- status block management (Phase 2) ---------- */
  const STATUS_BLOCK_PREFIX = "**TimeBlock Conflicts**";

  function findStatusBlockUid(pageUid) {
    const children = getDirectChildren(pageUid);
    for (const c of children) {
      if (c.string.startsWith(STATUS_BLOCK_PREFIX)) return c.uid;
    }
    return null;
  }

  async function deleteStatusBlock(pageUid) {
    const uid = findStatusBlockUid(pageUid);
    if (!uid) return false;
    try {
      await window.roamAlphaAPI.data.block.delete({ block: { uid } });
      return true;
    } catch (e) {
      log("warn", `delete status block ${uid} failed`, e?.message || e);
      return false;
    }
  }

  async function ensureStatusBlock(pageUid, conflicts, deadEnds) {
    if (!state.settings.conflictStatusBlock) return;
    const total = conflicts.length + deadEnds.length;
    if (total === 0) {
      await deleteStatusBlock(pageUid);
      return;
    }
    const headerString = `${STATUS_BLOCK_PREFIX} (${total}) #timeblock-status`;
    let statusUid = findStatusBlockUid(pageUid);
    if (!statusUid) {
      statusUid = window.roamAlphaAPI.util.generateUID();
      try {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": pageUid, order: "last" },
          block: { uid: statusUid, string: headerString, open: false },
        });
      } catch (e) {
        log("warn", `create status block failed`, e?.message || e);
        return;
      }
    } else {
      try {
        await window.roamAlphaAPI.data.block.update({
          block: { uid: statusUid, string: headerString },
        });
      } catch (e) {
        log("warn", `update status block string failed`, e?.message || e);
      }
    }
    // Wipe existing children and rewrite
    const existing = getDirectChildren(statusUid);
    for (const c of existing) {
      try { await window.roamAlphaAPI.data.block.delete({ block: { uid: c.uid } }); }
      catch {}
    }
    let order = 0;
    for (const conf of conflicts) {
      const aDesc = `${timeRangeOf(conf.a)} "${shortDescription(conf.a.string)}"`;
      const bDesc = `${timeRangeOf(conf.b)} "${shortDescription(conf.b.string)}"`;
      const line = `${aDesc} overlaps ${bDesc} — ${conf.overlapMinutes}min`;
      try {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": statusUid, order },
          block: { string: line },
        });
        order++;
      } catch (e) { log("debug", `conflict line create failed`, e?.message || e); }
    }
    for (const de of deadEnds) {
      const desc = `${timeRangeOf(de.item)} "${shortDescription(de.item.originalString)}"`;
      const line = `Dead-end: ${desc} — ${de.reason}`;
      try {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": statusUid, order },
          block: { string: line },
        });
        order++;
      } catch (e) { log("debug", `dead-end line create failed`, e?.message || e); }
    }
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

    const alreadyOrganized = isAlreadyOrganized(desired, currentTbChildren, pageLevelMisplaced);

    if (!alreadyOrganized) {
      const moveCount = pageLevelMisplaced.length + desired.filter((d, i) =>
        currentTbChildren[i]?.uid !== d.uid
      ).length;
      log("info", `reconciling TimeBlock on ${pageUid} (${reason}): ${pageLevelMisplaced.length} pulled in + reorder, ${moveCount} block.moves`);

      if (state.settings.dryRun) {
        log("info", `[dry-run] would move into order:`, desired.map(d => ({
          uid: d.uid,
          preview: d.string.slice(0, 50),
        })));
      } else {
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
    } else {
      debug(`page ${pageUid} already organized (${desired.length} children)`);
    }

    // ── Phase 3: auto-resolve conflicts (opt-in) ───────────────────────
    let resolvedUpdates = [];
    if (state.settings.conflictDetection && state.settings.autoResolveConflicts && !state.settings.dryRun) {
      const finalChildren = getDirectChildren(tbUid);
      const todos = finalChildren.filter(c => isTimePrefixed(c.string));
      const cutoff = parseCutoffTime(state.settings.cascadeCutoffTime);
      const result = resolveConflicts(todos, cutoff);
      if (result.updates.length > 0) {
        state.suppressUntil = Date.now() + state.settings.suppressMs;
        const api = window.roamAlphaAPI.data.block;
        for (const u of result.updates) {
          try {
            await api.update({ block: { uid: u.uid, string: u.newString } });
            resolvedUpdates.push(u);
            log("info", `bumped ((${u.uid})): ${formatMinAsHHMM(u.bumpedFrom.startMin)} → ${formatMinAsHHMM(u.bumpedTo.startMin)}`);
          } catch (e) {
            log("warn", `bump failed for ${u.uid}`, e?.message || e);
          }
        }
        if (resolvedUpdates.length > 0) {
          // After mutations, re-sort: time prefixes changed, so order may need refresh
          const refreshedChildren = getDirectChildren(tbUid);
          const refreshedTodos = refreshedChildren.filter(c => isTimePrefixed(c.string));
          const refreshedSorted = [...refreshedTodos].sort((a, b) =>
            parseTimePrefix(a.string).startMin - parseTimePrefix(b.string).startMin
          );
          // Compare against current order; if drift, re-move into sorted sequence
          let needsResort = false;
          for (let i = 0; i < refreshedTodos.length; i++) {
            if (refreshedTodos[i].uid !== refreshedSorted[i].uid) { needsResort = true; break; }
          }
          if (needsResort) {
            const buttons = refreshedChildren.filter(c => isSmartBlockButton(c.string));
            const others = refreshedChildren.filter(c =>
              !isTimePrefixed(c.string) && !isSmartBlockButton(c.string)
            );
            const finalDesired = [...others, ...refreshedSorted, ...buttons];
            for (const item of finalDesired) {
              try { await api.move({ location: { "parent-uid": tbUid, order: "last" }, block: { uid: item.uid } }); }
              catch (e) { log("warn", `post-bump re-sort move failed for ${item.uid}`, e?.message || e); }
            }
          }
        }
      }
    }

    // ── Phase 2: conflict detection + status block ─────────────────────
    if (state.settings.conflictDetection) {
      const finalChildren = getDirectChildren(tbUid);
      const todos = finalChildren.filter(c => isTimePrefixed(c.string));
      const conflicts = detectOverlaps(todos);
      // Re-detect dead-ends from any updates we attempted (resolveConflicts
      // returned them above — they apply even after partial bumps).
      let deadEnds = [];
      if (state.settings.autoResolveConflicts) {
        const cutoff = parseCutoffTime(state.settings.cascadeCutoffTime);
        const result = resolveConflicts(todos, cutoff); // re-run to detect any remaining
        deadEnds = result.deadEnds;
      }
      if (conflicts.length > 0 || deadEnds.length > 0) {
        log("warn", `${conflicts.length} conflict(s)${deadEnds.length ? ` + ${deadEnds.length} dead-end(s)` : ""} on page ${pageUid}`);
        for (const c of conflicts) {
          log("warn", `  ${timeRangeOf(c.a)} "${shortDescription(c.a.string)}" overlaps ${timeRangeOf(c.b)} "${shortDescription(c.b.string)}" (${c.overlapMinutes}min)`);
        }
        for (const de of deadEnds) {
          log("warn", `  dead-end: ${timeRangeOf(de.item)} "${shortDescription(de.item.originalString)}" — ${de.reason}`);
        }
        if (!state.settings.dryRun) {
          state.suppressUntil = Date.now() + state.settings.suppressMs;
          await ensureStatusBlock(pageUid, conflicts, deadEnds);
        }
      } else {
        if (!state.settings.dryRun) {
          state.suppressUntil = Date.now() + state.settings.suppressMs;
          await deleteStatusBlock(pageUid);
        }
      }
    }
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
    add("TimeBlock Organizer: toggle conflict detection (Phase 2)", toggleSetting("conflict_detection", "conflictDetection", "conflictDetection"));
    add("TimeBlock Organizer: toggle conflict status block on daily page", toggleSetting("conflict_status_block", "conflictStatusBlock", "conflictStatusBlock"));
    add("TimeBlock Organizer: toggle auto-resolve conflicts (Phase 3, opt-in)", toggleSetting("auto_resolve_conflicts", "autoResolveConflicts", "autoResolveConflicts"));
    add("TimeBlock Organizer: show conflicts on current page", async () => {
      let openUid;
      try { openUid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); }
      catch {}
      if (!openUid) return log("warn", "no open page detected");
      const tbUid = findTimeBlockUid(openUid);
      if (!tbUid) return log("info", `no TimeBlock parent on ${openUid}`);
      const finalChildren = getDirectChildren(tbUid);
      const todos = finalChildren.filter(c => isTimePrefixed(c.string));
      const conflicts = detectOverlaps(todos);
      const cutoff = parseCutoffTime(state.settings.cascadeCutoffTime);
      const { deadEnds } = resolveConflicts(todos, cutoff);
      if (conflicts.length === 0 && deadEnds.length === 0) {
        log("info", "no conflicts on this page");
        try { alert("No conflicts on this page."); } catch {}
        return;
      }
      const lines = [
        `${conflicts.length} conflict(s), ${deadEnds.length} dead-end(s):`,
        "",
        ...conflicts.map(c =>
          `• ${timeRangeOf(c.a)} "${shortDescription(c.a.string)}" overlaps ${timeRangeOf(c.b)} "${shortDescription(c.b.string)}" — ${c.overlapMinutes}min`
        ),
        ...deadEnds.map(de =>
          `× dead-end: ${timeRangeOf(de.item)} "${shortDescription(de.item.originalString)}" — ${de.reason}`
        ),
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });
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
        `  ${onOff(state.settings.conflictDetection)} conflict detection (Phase 2)`,
        `  ${onOff(state.settings.conflictStatusBlock)} status block on daily page`,
        `  ${onOff(state.settings.autoResolveConflicts)} auto-resolve conflicts (Phase 3, opt-in)`,
        ``,
        `── runtime ──`,
        `  Active watches: ${state.activeWatches.size} / ${state.settings.maxActiveWatches}`,
        `  Pending reconciles: ${state.pendingReconciles.size}`,
        `  Today UID: ${state.cachedTodayUid || "(none)"}`,
        `  TimeBlock signature: ${state.settings.timeblockSignature.slice(0, 60)}...`,
        `  SmartBlock button: ${state.settings.smartblockButtonSignature}`,
        `  Debounce: ${state.settings.debounceMs}ms / sweep: ${state.settings.sweepIntervalMs / 60000}min`,
        `  Conflict strategy: ${state.settings.conflictStrategy} / cutoff: ${state.settings.cascadeCutoffTime} / pinned marker: ${state.settings.pinnedMarker}`,
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
