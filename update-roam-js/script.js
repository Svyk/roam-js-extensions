/* update-roam-js v1.1.0
 *
 * v1.1.0 — Unified settings page [[Update Roam JS Settings]] (parity with
 * auto-attribute-todo v1.7.4 + triage-ptn v1.1.0). Five settings exposed
 * inline-editable: enabled, manifest_url, auto_check_on_load, cache_hours,
 * notify_on_updates. Toggles flipped via cmd palette write back to the
 * page. Plus idempotent registerCommands + auto-cleanup on init.
 *
 * v1.0.x — Bootstrap installer + auto-updater. Fetches scripts from a public
 * manifest (raw GitHub) and writes them into Roam pages (`roam/js/<name>`)
 * with the proper `{{[[roam/js]]}}` parent + code-block child structure. On
 * graph load: checks for newer versions of installed scripts (cached 24h),
 * surfaces a console notification if any are stale.
 *
 * Source: github.com/Svyk/roam-js-extensions
 */
;(function () {
  const VERSION = "1.1.1";
  const NAMESPACE = "update-roam-js";
  const SETTINGS_PAGE = "Update Roam JS Settings";
  const PAGE_PREFIX = "roam/js/";

  const DEFAULTS = {
    enabled: true,
    manifestUrl: "https://raw.githubusercontent.com/Svyk/roam-js-extensions/main/manifest.json",
    autoCheckOnLoad: true,
    cacheHours: 24,
    notifyOnUpdates: true,
  };

  const state = {
    settings: { ...DEFAULTS },
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;

  /* ---------- Settings ---------- */
  const GRAPH_SETTINGS = [
    ["enabled",             "enabled",          "bool",   true,
      "Master switch. false = cmd palette commands return early without doing anything."],
    ["manifest_url",        "manifestUrl",      "string", DEFAULTS.manifestUrl,
      "URL to the manifest JSON. Default points to github.com/Svyk/roam-js-extensions/main/manifest.json."],
    ["auto_check_on_load",  "autoCheckOnLoad",  "bool",   true,
      "Run a background update check 5s after the script loads. Off = cmd palette only."],
    ["cache_hours",         "cacheHours",       "int",    24,
      "How long to cache the manifest before re-fetching. Force a refresh via 'check for updates now'."],
    ["notify_on_updates",   "notifyOnUpdates",  "bool",   true,
      "Log a console warning when updates are available. Off = silent (still listed via 'check for updates')."],
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


  /* ---------- manifest ---------- */
  async function fetchManifest({ force = false } = {}) {
    const cached = JSON.parse(localStorage.getItem(sk("manifest")) || "null");
    const cachedAt = parseInt(localStorage.getItem(sk("manifest:at")) || "0", 10);
    const stillFresh = cached && (Date.now() - cachedAt) < state.settings.cacheHours * 3600 * 1000;
    if (cached && stillFresh && !force) return cached;
    log("info", "fetching manifest…");
    const r = await fetch(state.settings.manifestUrl, { cache: "no-store" });
    if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
    const m = await r.json();
    localStorage.setItem(sk("manifest"), JSON.stringify(m));
    localStorage.setItem(sk("manifest:at"), String(Date.now()));
    return m;
  }

  async function fetchScript(url) {
    log("info", `fetching ${url}`);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`script fetch failed: ${r.status}`);
    return await r.text();
  }

  /* ---------- Roam helpers ---------- */
  function pageUid(title) {
    return window.roamAlphaAPI.q(
      `[:find ?u . :where [?p :node/title "${title}"] [?p :block/uid ?u]]`
    );
  }

  function findRoamJsBlock(pageTitle) {
    const ru = pageUid(pageTitle);
    if (!ru) return null;
    const data = window.roamAlphaAPI.data.pull(
      "[{:block/children [:block/uid :block/string {:block/children [:block/uid :block/string]}]}]",
      [":block/uid", ru]
    );
    const ch = data?.[":block/children"] || [];
    const roamJs = ch.find((c) => (c[":block/string"] || "").includes("{{[[roam/js]]}}"));
    if (!roamJs) return null;
    const FENCE_START = "`".repeat(3);
    const code = (roamJs[":block/children"] || [])
      .find((c) => (c[":block/string"] || "").startsWith(FENCE_START));
    return {
      pageUid: ru,
      roamJsUid: roamJs[":block/uid"],
      codeBlockUid: code?.[":block/uid"] || null,
    };
  }

  function parseInstalledVersion(scriptText) {
    if (!scriptText) return null;
    const m = scriptText.match(/const\s+VERSION\s*=\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  }

  async function installScript({ name, url }) {
    const pageTitle = `${PAGE_PREFIX}${name}`;
    const code = await fetchScript(url);
    const FENCE = "`".repeat(3);
    const wrapped = FENCE + "javascript\n" + code + "\n" + FENCE;

    let ru = pageUid(pageTitle);
    if (!ru) {
      ru = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.page.create({ page: { title: pageTitle, uid: ru } });
      log("info", `created page [[${pageTitle}]]`);
    }

    let found = findRoamJsBlock(pageTitle);
    let roamJsUid = found?.roamJsUid;
    if (!roamJsUid) {
      roamJsUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": ru, order: 0 },
        block: { uid: roamJsUid, string: "{{[[roam/js]]}}" },
      });
      log("info", `created {{[[roam/js]]}} block on [[${pageTitle}]]`);
    }

    let codeBlockUid = found?.codeBlockUid;
    if (!codeBlockUid) {
      codeBlockUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": roamJsUid, order: 0 },
        block: { uid: codeBlockUid, string: wrapped },
      });
      log("info", `created code block on [[${pageTitle}]]`);
    } else {
      await window.roamAlphaAPI.data.block.update({ block: { uid: codeBlockUid, string: wrapped } });
      log("info", `updated code block on [[${pageTitle}]]`);
    }
    return { pageTitle, codeBlockUid };
  }

  async function uninstallScript({ name }) {
    const pageTitle = `${PAGE_PREFIX}${name}`;
    const ru = pageUid(pageTitle);
    if (!ru) { log("warn", `[[${pageTitle}]] not installed`); return; }
    try {
      const candidates = [`${name}_cleanup`, `auto-attr-todo_cleanup`, name.replace(/-/g, "_") + "_cleanup"];
      for (const k of candidates) if (typeof window[k] === "function") {
        try { window[k](); log("info", `called window.${k}()`); break; } catch {}
      }
    } catch {}
    await window.roamAlphaAPI.data.page.delete({ page: { uid: ru } });
    log("info", `deleted [[${pageTitle}]]`);
  }

  function compareVersions(a, b) {
    const pa = a.split(".").map((n) => parseInt(n, 10));
    const pb = b.split(".").map((n) => parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return 1; if (x < y) return -1;
    }
    return 0;
  }

  function getInstalledVersion(name) {
    const pageTitle = `${PAGE_PREFIX}${name}`;
    const found = findRoamJsBlock(pageTitle);
    if (!found?.codeBlockUid) return null;
    const data = window.roamAlphaAPI.data.pull("[:block/string]", [":block/uid", found.codeBlockUid]);
    return parseInstalledVersion(data?.[":block/string"]);
  }

  async function checkForUpdates() {
    let manifest;
    try { manifest = await fetchManifest({ force: true }); }
    catch (e) { log("error", "manifest fetch failed", e); return []; }
    const updates = [];
    for (const s of manifest.scripts) {
      const installed = getInstalledVersion(s.name);
      if (!installed) continue;
      if (compareVersions(s.version, installed) > 0) {
        updates.push({ name: s.name, installed, available: s.version });
      }
    }
    if (updates.length) {
      if (state.settings.notifyOnUpdates) {
        log("warn", `${updates.length} update(s) available`, updates);
        log("info", "run 'Update Roam JS: update all' to apply");
      }
    } else {
      log("info", "all installed scripts up to date");
    }
    return updates;
  }

  /* ---------- command palette ---------- */
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

    const guard = (fn) => async (...a) => {
      if (!state.settings.enabled) { log("warn", "disabled — toggle on via settings page or 'toggle enabled'"); return; }
      return fn(...a);
    };

    add("Update Roam JS: open settings page (edit toggles inline)", async () => {
      try { await ensureSettingsPage(true); log("info", "Settings page opened in right sidebar"); }
      catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("Update Roam JS: reload settings from graph", () => {
      const u = loadAllSettingsFromGraph();
      log("info", u > 0 ? `${u} setting(s) reloaded` : "no setting changes detected");
    });
    add("Update Roam JS: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("Update Roam JS: toggle auto-check on load", toggleSetting("auto_check_on_load", "autoCheckOnLoad", "autoCheckOnLoad"));
    add("Update Roam JS: toggle update notifications", toggleSetting("notify_on_updates", "notifyOnUpdates", "notifyOnUpdates"));
    add("Update Roam JS: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `update-roam-js v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.autoCheckOnLoad)} auto-check on load`,
        `  ${onOff(state.settings.notifyOnUpdates)} notify on updates`,
        ``,
        `── runtime ──`,
        `  Manifest URL: ${state.settings.manifestUrl}`,
        `  Cache hours: ${state.settings.cacheHours}`,
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });

    add("Update Roam JS: install all scripts", guard(async () => {
      let m;
      try { m = await fetchManifest({ force: true }); }
      catch (e) { return log("error", "manifest fetch failed", e); }
      let ok = 0, fail = 0;
      for (const s of m.scripts) {
        if (s.name === "update-roam-js") continue;
        try { await installScript(s); ok++; }
        catch (e) { log("error", `install failed: ${s.name}`, e); fail++; }
      }
      log("info", `install complete — ${ok} ok, ${fail} failed`);
      log("info", "REFRESH the page once for each new roam/js page; click 'Yes' to allow JS execution.");
    }));

    add("Update Roam JS: update all scripts to latest", guard(async () => {
      let m;
      try { m = await fetchManifest({ force: true }); }
      catch (e) { return log("error", "manifest fetch failed", e); }
      let ok = 0, skip = 0, fail = 0;
      for (const s of m.scripts) {
        if (s.name === "update-roam-js") continue;
        const installed = getInstalledVersion(s.name);
        if (!installed) { skip++; continue; }
        if (compareVersions(s.version, installed) <= 0) { skip++; continue; }
        try { await installScript(s); ok++; }
        catch (e) { log("error", `update failed: ${s.name}`, e); fail++; }
      }
      log("info", `update complete — ${ok} updated, ${skip} skipped, ${fail} failed`);
    }));

    add("Update Roam JS: check for updates now", guard(async () => { await checkForUpdates(); }));

    add("Update Roam JS: list available scripts", async () => {
      let m;
      try { m = await fetchManifest({ force: true }); }
      catch (e) { return log("error", "manifest fetch failed", e); }
      console.table(m.scripts.map((s) => ({
        name: s.name,
        version: s.version,
        installed: getInstalledVersion(s.name) || "(none)",
        auto_runs: !!s.auto_runs,
        description: s.description,
      })));
    });

    fetchManifest().then((m) => {
      for (const s of m.scripts) {
        if (s.name === "update-roam-js") continue;
        add(`Update Roam JS: install ${s.name}`, guard(async () => {
          try { await installScript(s); log("info", `installed ${s.name} — refresh page, click 'Yes' to allow JS`); }
          catch (e) { log("error", `install ${s.name} failed`, e); }
        }));
        add(`Update Roam JS: update ${s.name}`, guard(async () => {
          try { await installScript(s); log("info", `updated ${s.name} — refresh page to load new version`); }
          catch (e) { log("error", `update ${s.name} failed`, e); }
        }));
        add(`Update Roam JS: uninstall ${s.name}`, guard(async () => { await uninstallScript({ name: s.name }); }));
      }
    }).catch((e) => log("warn", "deferred per-script command registration failed", e));
  }

  /* ---------- init ---------- */
  function init() {
    log("info", `v${VERSION} starting (manifest: ${DEFAULTS.manifestUrl})`);
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
    if (state.settings.autoCheckOnLoad && state.settings.enabled) {
      setTimeout(() => {
        checkForUpdates().catch((e) => log("warn", "background check failed", e));
      }, 5000);
    }
    window[`${NAMESPACE}_state`] = state;
    log("info", "ready — open command palette: 'Update Roam JS'");
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
