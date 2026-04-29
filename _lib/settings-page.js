// === SETTINGS-PAGE LIB START v1.0.0 ===
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
