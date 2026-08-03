/* daily-summary v1.1.0
 *
 * v1.1.0 — Unified settings page [[Daily Summary Settings]] (parity with
 * auto-attribute-todo v1.7.4 + triage-ptn v1.1.0). Six settings exposed
 * inline-editable: enabled, model_override, temperature, today_header,
 * tomorrow_header, include_linked_refs. Plus idempotent registerCommands +
 * auto-cleanup on init.
 *
 * v1.0.x — One-button daily-page summary widget. Cmd palette commands:
 * "refresh top-of-day" (reads today's daily page + linked refs → 2-sentence
 * summary as a top block under "Today's Vibe ::" header) and "refresh
 * tomorrow's prep" (same but for [[tomorrow]] daily page). NOT a real-time
 * watcher — explicit-trigger only to keep cost predictable. Re-runs are
 * idempotent (header block + child summary; rerun overwrites in place).
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.1.1";
  const NAMESPACE = "daily-summary";
  const SETTINGS_PAGE = "Daily Summary Settings";

  const DEFAULTS = {
    enabled: true,
    modelOverride: "",
    temperature: 0.6,         // moderate — slight variation in vibe summaries is fine
    todayHeader: "Today's Vibe ::",
    tomorrowHeader: "Tomorrow's Outlook ::",
    includeLinkedRefs: true,  // default on for daily summary (full picture)
  };

  const state = {
    settings: { ...DEFAULTS },
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) => console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;

  /* ---------- Settings ---------- */
  const GRAPH_SETTINGS = [
    ["enabled",             "enabled",            "bool",   true,  "Master switch. false = refresh commands return early."],
    ["model_override",      "modelOverride",      "string", "",    "LLM model id (e.g. 'gpt-5.1-mini' for cheap daily runs). Leave empty for LiveAI default."],
    ["temperature",         "temperature",        "float",  0.6,   "0 = deterministic, 2 = creative. 0.6 default — slight variation in vibe summaries is fine."],
    ["today_header",        "todayHeader",        "string", "Today's Vibe ::", "Header text for the today-summary block. Default 'Today's Vibe ::' is collapsable in Roam."],
    ["tomorrow_header",     "tomorrowHeader",     "string", "Tomorrow's Outlook ::", "Header text for the tomorrow-prep block."],
    ["include_linked_refs", "includeLinkedRefs",  "bool",   true,  "Pull linked references into roamContext. Off = just the daily page itself (faster + cheaper but less context)."],
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


  /* ---------- core ---------- */
  function ordinal(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }
  function formatPageTitle(date) {
    const m = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${m[date.getMonth()]} ${date.getDate()}${ordinal(date.getDate())}, ${date.getFullYear()}`;
  }
  function formatPageUid(date) {
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${mm}-${dd}-${date.getFullYear()}`;
  }

  async function ensureHeaderBlock(pageUid, header) {
    const data = window.roamAlphaAPI.data.pull(
      "[{:block/children [:block/uid :block/string :block/order]}]",
      [":block/uid", pageUid]
    );
    const ch = (data?.[":block/children"]) || [];
    const existing = ch.find(c => (c[":block/string"] || "").startsWith(header));
    if (existing) {
      const child = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid]}]", [":block/uid", existing[":block/uid"]]
      );
      for (const c of (child?.[":block/children"] || [])) {
        await window.roamAlphaAPI.data.block.delete({ block: { uid: c[":block/uid"] } });
      }
      return existing[":block/uid"];
    }
    const newUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": pageUid, order: 0 },
      block: { uid: newUid, string: `${header} _(refresh via cmd-palette)_` },
    });
    return newUid;
  }

  async function refreshFor({ date, header, prompt, systemPrompt, ensurePageExists }) {
    if (!state.settings.enabled) {
      log("warn", "disabled — toggle on via settings page or 'toggle enabled'");
      return;
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return;
    }
    const pageUid = formatPageUid(date);
    const pageTitle = formatPageTitle(date);
    if (ensurePageExists) {
      try { await window.roamAlphaAPI.data.page.create({ page: { title: pageTitle, uid: pageUid } }); }
      catch {} // already exists is fine
    }
    log("info", `refreshing for ${pageTitle} (uid=${pageUid})`);
    const headerUid = await ensureHeaderBlock(pageUid, header);
    if (!headerUid) { log("error", "could not create/find header block"); return; }
    try {
      const opts = {
        prompt,
        systemPrompt,
        useDefaultSystemPrompt: false,
        roamContext: {
          page: true,
          pageArgument: [pageTitle],
          linkedRefs: state.settings.includeLinkedRefs,
          linkedRefsArgument: state.settings.includeLinkedRefs ? [pageTitle] : undefined,
        },
        output: "insert",
        targetUid: headerUid,
        caller: `${NAMESPACE}/${VERSION}`,
        temperature: state.settings.temperature,
      };
      if (state.settings.modelOverride) opts.model = state.settings.modelOverride;
      await window.LiveAI_API.generate(opts);
      log("info", "refresh complete");
    } catch (e) {
      log("error", "refresh failed", e);
    }
  }

  async function refreshToday() {
    return refreshFor({
      date: new Date(),
      header: state.settings.todayHeader,
      prompt: "Summarize what's happening today. Keep it to 2 sentences. Lead with the top priority. End with one observation about energy / vibe / momentum.",
      systemPrompt: "You are a brief daily-vibe summarizer for Svyatoslav (Svy) Kleshchev. Read today's daily page + linked refs. Output 2 sentences max, plain prose, no headers, no bullets, no lists. Honest tone — if the day looks chaotic say so; if it's quiet say so. Reference specific items by name when useful. No throat-clearing openers.",
      ensurePageExists: false,
    });
  }

  async function refreshTomorrow() {
    const t = new Date(); t.setDate(t.getDate() + 1);
    return refreshFor({
      date: t,
      header: state.settings.tomorrowHeader,
      prompt: "Outline what tomorrow looks like in 2-3 sentences. Lead with the top priority. Note any meetings or hard deadlines.",
      systemPrompt: "Brief outlook for tomorrow. Read [[tomorrow]] daily page + recent open Better Tasks. 2-3 sentences max, plain prose. Reference specific tasks by name.",
      ensurePageExists: true,
    });
  }

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

    add("Daily Summary: open settings page (edit toggles inline)", async () => {
      try { await ensureSettingsPage(true); log("info", "Settings page opened in right sidebar"); }
      catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("Daily Summary: reload settings from graph", () => {
      const u = loadAllSettingsFromGraph();
      log("info", u > 0 ? `${u} setting(s) reloaded` : "no setting changes detected");
    });
    add("Daily Summary: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("Daily Summary: toggle include linked refs in context", toggleSetting("include_linked_refs", "includeLinkedRefs", "includeLinkedRefs"));
    add("Daily Summary: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `daily-summary v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.includeLinkedRefs)} include linked refs in context`,
        ``,
        `── tunables ──`,
        `  Model: ${state.settings.modelOverride || "(LiveAI default)"}`,
        `  Temperature: ${state.settings.temperature}`,
        `  Today header: ${state.settings.todayHeader}`,
        `  Tomorrow header: ${state.settings.tomorrowHeader}`,
        `  LiveAI available: ${!!window.LiveAI_API?.isAvailable()}`,
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });

    add("Daily Summary: refresh top-of-day", refreshToday);
    add("Daily Summary: refresh tomorrow's prep", refreshTomorrow);
  }

  function init() {
    log("info", `v${VERSION} starting`);
    const priorCleanup = window[`${NAMESPACE}_cleanup`];
    if (typeof priorCleanup === "function") {
      try { priorCleanup(); log("info", "cleaned up prior version"); }
      catch (e) { log("warn", "prior cleanup threw", e?.message || e); }
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, refresh will fail until LiveAI loads.");
    }
    loadPersistentSettings();
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      .catch(e => log("warn", "settings page bootstrap failed", e?.message || e));
    registerCommands();
    window[`${NAMESPACE}_state`] = state;
    log("info", "ready — open command palette: 'Daily Summary'");
  }

  function cleanup() {
    if (state.registeredCommandLabels) {
      for (const label of state.registeredCommandLabels) {
        try { window.roamAlphaAPI.ui.commandPalette.removeCommand({ label }); } catch {}
      }
      state.registeredCommandLabels.clear();
    }
  }
  window[`${NAMESPACE}_cleanup`] = cleanup;
  init();
})();
