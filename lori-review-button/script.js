/* lori-review-button v1.1.0
 *
 * v1.1.0 — Unified settings page [[Lori Review Settings]] (parity with
 * auto-attribute-todo v1.7.4 + triage-ptn v1.1.0). Six settings exposed
 * inline-editable: enabled, model_override, temperature, header_label,
 * append_to_sidebar, include_linked_refs. Plus idempotent registerCommands
 * + auto-cleanup on init.
 *
 * v1.0.x — Adds command-palette commands to run a Lori-Boyd-style QA review
 * on the current page (typically a SOP, deviation, EMP doc). Reads page
 * content via roamContext, inserts review comments as nested children
 * under a "Lori Review — [time]" heading at the bottom of the page.
 * Two modes: full (6-pass) and quick scan (data + ambiguous only).
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.1.0";
  const NAMESPACE = "lori-review-button";
  const SETTINGS_PAGE = "Lori Review Settings";

  const DEFAULTS = {
    enabled: true,
    modelOverride: "",        // empty = LiveAI default
    temperature: 0.3,         // low = deterministic, good for review
    headerLabel: "Lori Review",
    appendToSidebar: false,   // off = append to page bottom, on = open in sidebar
    includeLinkedRefs: false, // include linked refs in roamContext
  };

  const state = {
    settings: { ...DEFAULTS },
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) => console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;

  /* ---------- Settings ---------- */
  const GRAPH_SETTINGS = [
    ["enabled",             "enabled",           "bool",   true,  "Master switch. false = review commands return early."],
    ["model_override",      "modelOverride",     "string", "",    "LLM model id (e.g. 'claude-sonnet-4'). Leave empty for LiveAI default. Lori-style review benefits from a strong model."],
    ["temperature",         "temperature",       "float",  0.3,   "0 = deterministic, 2 = creative. 0.3 default for review (consistent, picky)."],
    ["header_label",        "headerLabel",       "string", "Lori Review", "Header text for review blocks. Default 'Lori Review' produces 'Lori Review — Apr 28th, 2026 14:32 _(full)_'."],
    ["append_to_sidebar",   "appendToSidebar",   "bool",   false, "false = append review at bottom of page. true = also open the review block in the right sidebar."],
    ["include_linked_refs", "includeLinkedRefs", "bool",   false, "Include linked references in roamContext. Helps for hub pages, hurts for stand-alone SOPs (more noise)."],
  ];

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
        if (stored[settingsKey] !== undefined) state.settings[settingsKey] = stored[settingsKey];
      }
    } catch (e) { log("warn", "loadPersistentSettings failed", e); }
  }
  function persistSettings() {
    try {
      const obj = {};
      for (const [, settingsKey] of GRAPH_SETTINGS) obj[settingsKey] = state.settings[settingsKey];
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
        const parsed = parseSettingValue(type, blocksByKey[graphKey]);
        if (parsed === null) continue;
        if (state.settings[settingsKey] === parsed) continue;
        state.settings[settingsKey] = parsed;
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
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": pageUid, order },
      block: { uid: blockUid, string: `${graphKey}:: ${formatSettingValue(type, currentValue)}` },
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
    const value = state.settings[settingsKey];
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
        block: { uid: headerUid, string: "**How to use this page** — every setting below is `key:: value`. Edit inline. Reload via cmd palette → \"Lori Review: reload settings from graph\"." },
      });
    }
    let order = 1;
    for (const [graphKey, settingsKey, type, , description] of GRAPH_SETTINGS) {
      await ensureSettingsBlock(pageUid, graphKey, type, state.settings[settingsKey], description, order);
      order++;
    }
    if (openInSidebar) {
      try { await window.roamAlphaAPI.ui.rightSidebar.addWindow({ window: { type: "outline", "block-uid": pageUid } }); }
      catch {
        try { await window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: pageUid } }); } catch {}
      }
    }
    return pageUid;
  }

  /* ---------- core ---------- */
  function ordinal(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }
  function nowLabel() {
    const d = new Date();
    const m = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const date = `${m[d.getMonth()]} ${d.getDate()}${ordinal(d.getDate())}, ${d.getFullYear()}`;
    const time = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `${date} ${time}`;
  }

  function currentPageUid() {
    try {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (f?.["page-uid"]) return f["page-uid"];
    } catch {}
    try { return window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); } catch {}
    return null;
  }

  function getPageTitle(uid) {
    try {
      const p = window.roamAlphaAPI.data.pull("[:node/title]", [":block/uid", uid]);
      return p?.[":node/title"] || null;
    } catch { return null; }
  }

  async function runReview({ mode }) {
    if (!state.settings.enabled) {
      log("warn", "disabled — toggle on via settings page or 'toggle enabled'");
      return;
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return;
    }
    const pageUid = currentPageUid();
    if (!pageUid) { log("warn", "could not detect current page"); return; }
    const title = getPageTitle(pageUid);
    if (!title) { log("warn", `not on a page (uid=${pageUid}) — open a SOP/deviation/document page first`); return; }

    log("info", `running ${mode} review on [[${title}]]`);

    const headerUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid: headerUid, string: `**${state.settings.headerLabel} — ${nowLabel()}** _(${mode})_` },
    });

    const fullSystemPrompt = `You are reviewing a Roam page as Lori Boyd (senior QA reviewer at ByHeart, BlendHouse Portland) would. Lori's question on every sentence: "Does this make sense to someone reading it for the first time?" She is direct and pragmatic, not academic.

Run six passes. Group your output by the six categories below as Roam bullets. For each finding: quote the exact offending phrase, name the issue, suggest a concrete fix.

1. **Data Context** — every number must show its denominator, scale, or timeframe. Flag "47 high-temp hours" → suggest "47 of 1,440 total hours, 3.3%".
2. **Undefined Terms** — every acronym expanded on first use; every unfamiliar term defined.
3. **Ambiguous Language** — flag every "and/or" (force pick), "to/from" (force direction), "as needed" / "if applicable" (define the trigger).
4. **Facility Inconsistency** — tool color coding (red=sanitation, blue=production), PPE rules, hairnet/beardnet language must match BlendHouse Portland conventions.
5. **Copy-Paste Errors** — same form name with different revision numbers, mismatched section refs, leftover template boilerplate ("Additional sections may be added", "i.e., Forms, etc."), placeholder stubs ("TBD", "Dd", "N/A" in completed sections).
6. **Logical Flow** — does each step follow from the previous? Could a floor operator execute this without asking a question?

If a category has no findings, write a single bullet: "(no findings)".
End with a one-sentence summary: total findings + most-pressing category.`;

    const quickSystemPrompt = `You are doing a fast Lori-Boyd-style scan of a Roam page. Run only two passes:

1. **Data Context** — flag any numbers without a denominator, scale, or timeframe.
2. **Ambiguous Language** — flag every "and/or", "to/from", "as needed", "if applicable", "when appropriate".

For each finding: quote the phrase, suggest a concrete fix. Use Roam bullets. If no findings, write "(no findings)". End with a one-sentence summary.`;

    try {
      const opts = {
        prompt: `Review the page [[${title}]] per the system prompt.`,
        systemPrompt: mode === "full" ? fullSystemPrompt : quickSystemPrompt,
        useDefaultSystemPrompt: false,
        roamContext: {
          page: true,
          pageArgument: [title],
          pageViewUid: pageUid,
          linkedRefs: state.settings.includeLinkedRefs,
          linkedRefsArgument: state.settings.includeLinkedRefs ? [title] : undefined,
        },
        output: "insert",
        targetUid: headerUid,
        caller: `${NAMESPACE}/${VERSION}`,
        temperature: state.settings.temperature,
      };
      if (state.settings.modelOverride) opts.model = state.settings.modelOverride;
      await window.LiveAI_API.generate(opts);
      log("info", `${mode} review complete on [[${title}]]`);
      if (state.settings.appendToSidebar) {
        try {
          await window.roamAlphaAPI.ui.rightSidebar.addWindow({
            window: { type: "block", "block-uid": headerUid },
          });
        } catch (e) { log("debug", "sidebar open failed", e?.message || e); }
      }
    } catch (e) {
      log("error", `review failed on [[${title}]]`, e);
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": headerUid, order: 0 },
        block: { string: `_(error: ${e.message || "unknown"})_` },
      });
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

    add("Lori Review: open settings page (edit toggles inline)", async () => {
      try { await ensureSettingsPage(true); log("info", "Settings page opened in right sidebar"); }
      catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("Lori Review: reload settings from graph", () => {
      const u = loadAllSettingsFromGraph();
      log("info", u > 0 ? `${u} setting(s) reloaded` : "no setting changes detected");
    });
    add("Lori Review: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("Lori Review: toggle append-to-sidebar after review", toggleSetting("append_to_sidebar", "appendToSidebar", "appendToSidebar"));
    add("Lori Review: toggle include linked refs in context", toggleSetting("include_linked_refs", "includeLinkedRefs", "includeLinkedRefs"));
    add("Lori Review: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `lori-review-button v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.appendToSidebar)} append-to-sidebar after review`,
        `  ${onOff(state.settings.includeLinkedRefs)} include linked refs in context`,
        ``,
        `── tunables ──`,
        `  Model: ${state.settings.modelOverride || "(LiveAI default)"}`,
        `  Temperature: ${state.settings.temperature}`,
        `  Header label: ${state.settings.headerLabel}`,
        `  LiveAI available: ${!!window.LiveAI_API?.isAvailable()}`,
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });

    add("Lori Review: full (6-pass)", () => runReview({ mode: "full" }));
    add("Lori Review: quick scan (data + ambiguous)", () => runReview({ mode: "quick" }));
  }

  function init() {
    log("info", `v${VERSION} starting`);
    const priorCleanup = window[`${NAMESPACE}_cleanup`];
    if (typeof priorCleanup === "function") {
      try { priorCleanup(); log("info", "cleaned up prior version"); }
      catch (e) { log("warn", "prior cleanup threw", e?.message || e); }
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, reviews will fail until LiveAI loads.");
    }
    loadPersistentSettings();
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      .catch(e => log("warn", "settings page bootstrap failed", e?.message || e));
    registerCommands();
    window[`${NAMESPACE}_state`] = state;
    log("info", "ready — open a SOP/deviation page, run 'Lori Review' from cmd palette");
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
