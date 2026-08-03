/* explain-block v1.1.0
 *
 * v1.1.0 — Unified settings page [[Explain Block Settings]] (parity with
 * auto-attribute-todo v1.7.4 + triage-ptn v1.1.0). Five settings exposed
 * inline-editable: enabled, model_override, temperature, path_depth,
 * include_children. Plus idempotent registerCommands + auto-cleanup on init.
 *
 * v1.0.x — Adds command-palette commands to "explain" the focused block via
 * LiveAI_API. Five modes: brief, detailed, translate (English ↔ Russian),
 * Lori-Boyd-style critique, define unfamiliar terms. Uses roamContext to
 * pull the block + breadcrumb path automatically.
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.1.1";
  const NAMESPACE = "explain-block";
  const SETTINGS_PAGE = "Explain Block Settings";

  const DEFAULTS = {
    enabled: true,
    modelOverride: "",        // empty = use LiveAI default
    temperature: 0.7,
    pathDepth: 3,
    includeChildren: true,
  };

  const state = {
    settings: { ...DEFAULTS },
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) => console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;

  /* ---------- Settings ---------- */
  const GRAPH_SETTINGS = [
    ["enabled",          "enabled",         "bool",   true,  "Master switch. false = explain commands return early."],
    ["model_override",   "modelOverride",   "string", "",    "LLM model id (e.g. 'claude-sonnet-4', 'gpt-5.1'). Leave empty to use LiveAI's default. Use 'listModels()' on the LiveAI side to see options."],
    ["temperature",      "temperature",     "float",  0.7,   "0 = deterministic, 2 = wild. 0.7 is a good default for explanations; lower for translation."],
    ["path_depth",       "pathDepth",       "int",    3,     "How many breadcrumb levels to include in roamContext (1 = just parent, 5 = deep nesting)."],
    ["include_children", "includeChildren", "bool",   true,  "Include the focused block's children in roamContext. Off = explain only the block itself."],
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
  function focusedBlock() {
    return window.roamAlphaAPI.ui.getFocusedBlock();
  }

  async function callAndInsert({ uid, systemPrompt, prompt, headerLabel }) {
    if (!state.settings.enabled) {
      log("warn", "disabled — toggle on via settings page or 'toggle enabled'");
      return;
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return;
    }
    log("info", `running on ((${uid})): ${headerLabel}`);
    try {
      const opts = {
        prompt,
        systemPrompt,
        useDefaultSystemPrompt: true,
        roamContext: {
          block: true, blockArgument: [uid],
          path: true, pathDepth: state.settings.pathDepth,
          children: state.settings.includeChildren,
        },
        output: "insert",
        targetUid: uid,
        caller: `${NAMESPACE}/${VERSION}`,
        temperature: state.settings.temperature,
      };
      if (state.settings.modelOverride) opts.model = state.settings.modelOverride;
      await window.LiveAI_API.generate(opts);
      log("info", `done: ${headerLabel}`);
    } catch (e) {
      log("error", `failed: ${headerLabel}`, e);
    }
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

    add("Explain block: open settings page (edit toggles inline)", async () => {
      try { await ensureSettingsPage(true); log("info", "Settings page opened in right sidebar"); }
      catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("Explain block: reload settings from graph", () => {
      const u = loadAllSettingsFromGraph();
      log("info", u > 0 ? `${u} setting(s) reloaded` : "no setting changes detected");
    });
    add("Explain block: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("Explain block: toggle include children in context", toggleSetting("include_children", "includeChildren", "includeChildren"));
    add("Explain block: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `explain-block v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.includeChildren)} include children in context`,
        ``,
        `── tunables ──`,
        `  Model: ${state.settings.modelOverride || "(LiveAI default)"}`,
        `  Temperature: ${state.settings.temperature}`,
        `  Path depth: ${state.settings.pathDepth}`,
        `  LiveAI available: ${!!window.LiveAI_API?.isAvailable()}`,
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });

    add("Explain block (brief)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "You are explaining a Roam block to its writer. They wrote it; they know the surface meaning. Surface what's IMPLICIT — what they assume the reader knows, what's NOT said but matters, why this matters in the context of the parent path. Keep it to 2-3 sentences. Do not restate the block. Do not flatter. Plain prose, no lists.",
        prompt: "Explain in 2-3 sentences. Focus on what's implicit or assumed.",
        headerLabel: "explain (brief)",
      });
    });

    add("Explain block (detailed, nested)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "You are providing a detailed explanation of a Roam block to its writer. Structure: a brief plain-language restatement (1 sentence), then 2-4 hierarchical bullets covering: implicit assumptions, what's missing or unclear, key tradeoffs or alternatives, and one suggested next action if relevant. Use Roam's hierarchical bullet format. Be direct, no filler.",
        prompt: "Explain in detail with hierarchical bullets.",
        headerLabel: "explain (detailed)",
      });
    });

    add("Explain block: translate (English ↔ Russian)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "Translate the focused block. If the source is English, output Russian. If the source is Russian, output English. Preserve any technical terms, proper nouns, code, and Roam syntax (block refs, page links, attribute :: blocks) verbatim. Output a single block with just the translation — no commentary, no source-language repetition.",
        prompt: "Translate as instructed.",
        headerLabel: "translate",
      });
    });

    add("Explain block: critique (Lori Boyd lens)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "Critique the focused block as Lori Boyd (senior QA reviewer at ByHeart) would. Focus on: data without context (numbers without denominators or scales), undefined terms or abbreviations, ambiguous procedure language (and/or, to/from, as needed), copy-paste leftovers, logical flow gaps. For each issue, quote the offending phrase and suggest a concrete fix. If there are no issues, say so in one sentence. Use bullet points.",
        prompt: "Critique with Lori's pragmatic-QA lens.",
        headerLabel: "lori critique",
      });
    });

    add("Explain block: define unfamiliar terms", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "Identify any acronyms, technical terms, jargon, or proper nouns in the focused block that a general reader might not know. For each, give a one-line plain definition. Use one bullet per term. If everything is universally clear, write a single bullet '(no unfamiliar terms found)'.",
        prompt: "List and define unfamiliar terms.",
        headerLabel: "define terms",
      });
    });
  }

  function init() {
    log("info", `v${VERSION} starting`);
    const priorCleanup = window[`${NAMESPACE}_cleanup`];
    if (typeof priorCleanup === "function") {
      try { priorCleanup(); log("info", "cleaned up prior version"); }
      catch (e) { log("warn", "prior cleanup threw", e?.message || e); }
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, calls will fail until LiveAI loads with public API enabled.");
    }
    loadPersistentSettings();
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      .catch(e => log("warn", "settings page bootstrap failed", e?.message || e));
    registerCommands();
    window[`${NAMESPACE}_state`] = state;
    log("info", "ready — open command palette and type 'Explain block'");
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
