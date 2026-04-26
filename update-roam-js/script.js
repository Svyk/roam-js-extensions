/* update-roam-js v1.0.0
 *
 * Bootstrap installer + auto-updater for the LiveAI_API roam/js suite.
 * Fetches scripts from a public manifest (raw GitHub) and writes them into
 * Roam pages (`roam/js/<name>`) with the proper `{{[[roam/js]]}}` parent +
 * code-block child structure.
 *
 * On graph load: checks for newer versions of installed scripts (cached 24h),
 * surfaces a console notification if any are stale.
 *
 * Commands:
 *   "Update Roam JS: install all scripts" — one-shot install of the whole suite
 *   "Update Roam JS: install <name>"      — install one specific script
 *   "Update Roam JS: update all"          — overwrite installed pages with latest
 *   "Update Roam JS: update <name>"       — update one specific script
 *   "Update Roam JS: check for updates"   — manual version check
 *   "Update Roam JS: list available"      — show manifest
 *   "Update Roam JS: uninstall <name>"    — delete the roam/js page (cleanup runs)
 *
 * Source: github.com/Svyk/roam-js-extensions
 */
;(function () {
  const VERSION = "1.0.1";
  const NAMESPACE = "update-roam-js";
  const MANIFEST_URL = "https://raw.githubusercontent.com/Svyk/roam-js-extensions/main/manifest.json";
  const CACHE_HOURS = 24;
  const PAGE_PREFIX = "roam/js/";

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;

  /* ---------- manifest ---------- */
  async function fetchManifest({ force = false } = {}) {
    const cached = JSON.parse(localStorage.getItem(sk("manifest")) || "null");
    const cachedAt = parseInt(localStorage.getItem(sk("manifest:at")) || "0", 10);
    const stillFresh = cached && (Date.now() - cachedAt) < CACHE_HOURS * 3600 * 1000;
    if (cached && stillFresh && !force) return cached;
    log("info", "fetching manifest…");
    const r = await fetch(MANIFEST_URL, { cache: "no-store" });
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
    // returns { roamJsUid, codeBlockUid } if found
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
    // Build fence at runtime so this script's source has no literal triple-backticks
    // (those would collide with the outer Roam fence if the FULL update-roam-js were
    // ever installed directly into a roam/js page instead of via the shim).
    const FENCE = "`".repeat(3);
    const wrapped = FENCE + "javascript\n" + code + "\n" + FENCE;

    // Ensure page exists
    let ru = pageUid(pageTitle);
    if (!ru) {
      ru = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.page.create({
        page: { title: pageTitle, uid: ru },
      });
      log("info", `created page [[${pageTitle}]]`);
    }

    // Find or create the {{[[roam/js]]}} block
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

    // Find or create the code-block child
    let codeBlockUid = found?.codeBlockUid;
    if (!codeBlockUid) {
      codeBlockUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": roamJsUid, order: 0 },
        block: { uid: codeBlockUid, string: wrapped },
      });
      log("info", `created code block on [[${pageTitle}]]`);
    } else {
      await window.roamAlphaAPI.data.block.update({
        block: { uid: codeBlockUid, string: wrapped },
      });
      log("info", `updated code block on [[${pageTitle}]]`);
    }
    return { pageTitle, codeBlockUid };
  }

  async function uninstallScript({ name }) {
    const pageTitle = `${PAGE_PREFIX}${name}`;
    const ru = pageUid(pageTitle);
    if (!ru) {
      log("warn", `[[${pageTitle}]] not installed`);
      return;
    }
    // Try to call cleanup first
    try {
      const ns = `${name.replaceAll("-", "_")}_cleanup`;
      const altNs = name.replace(/-/g, "_") + "_cleanup";
      const candidates = [`${name}_cleanup`, `auto-attr-todo_cleanup`, altNs];
      for (const k of candidates) if (typeof window[k] === "function") {
        try { window[k](); log("info", `called window.${k}()`); break; } catch {}
      }
    } catch {}
    await window.roamAlphaAPI.data.page.delete({ page: { uid: ru } });
    log("info", `deleted [[${pageTitle}]]`);
  }

  /* ---------- version diffing ---------- */
  function compareVersions(a, b) {
    const pa = a.split(".").map((n) => parseInt(n, 10));
    const pb = b.split(".").map((n) => parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function getInstalledVersion(name) {
    const pageTitle = `${PAGE_PREFIX}${name}`;
    const found = findRoamJsBlock(pageTitle);
    if (!found?.codeBlockUid) return null;
    const data = window.roamAlphaAPI.data.pull(
      "[:block/string]", [":block/uid", found.codeBlockUid]
    );
    return parseInstalledVersion(data?.[":block/string"]);
  }

  async function checkForUpdates() {
    let manifest;
    try { manifest = await fetchManifest({ force: true }); }
    catch (e) { log("error", "manifest fetch failed", e); return []; }
    const updates = [];
    for (const s of manifest.scripts) {
      const installed = getInstalledVersion(s.name);
      if (!installed) continue;  // not installed → not "stale"
      if (compareVersions(s.version, installed) > 0) {
        updates.push({ name: s.name, installed, available: s.version });
      }
    }
    if (updates.length) {
      log("warn", `${updates.length} update(s) available`, updates);
      log("info", "run 'Update Roam JS: update all' to apply");
    } else {
      log("info", "all installed scripts up to date");
    }
    return updates;
  }

  /* ---------- command palette ---------- */
  function registerCommands() {
    const add = (label, cb) => {
      try { window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback: cb }); }
      catch (e) { log("warn", `add cmd: ${label}`, e); }
    };

    add("Update Roam JS: install all scripts", async () => {
      let m;
      try { m = await fetchManifest({ force: true }); }
      catch (e) { return log("error", "manifest fetch failed", e); }
      let ok = 0, fail = 0;
      for (const s of m.scripts) {
        if (s.name === "update-roam-js") continue;  // self
        try { await installScript(s); ok++; }
        catch (e) { log("error", `install failed: ${s.name}`, e); fail++; }
      }
      log("info", `install complete — ${ok} ok, ${fail} failed`);
      log("info", "REFRESH the page once for each new roam/js page; click 'Yes' to allow JS execution.");
    });

    add("Update Roam JS: update all scripts to latest", async () => {
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
    });

    add("Update Roam JS: check for updates now", async () => {
      await checkForUpdates();
    });

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

    // One command per script for install / update / uninstall
    fetchManifest().then((m) => {
      for (const s of m.scripts) {
        if (s.name === "update-roam-js") continue;
        add(`Update Roam JS: install ${s.name}`, async () => {
          try { await installScript(s); log("info", `installed ${s.name} — refresh page, click 'Yes' to allow JS`); }
          catch (e) { log("error", `install ${s.name} failed`, e); }
        });
        add(`Update Roam JS: update ${s.name}`, async () => {
          try { await installScript(s); log("info", `updated ${s.name} — refresh page to load new version`); }
          catch (e) { log("error", `update ${s.name} failed`, e); }
        });
        add(`Update Roam JS: uninstall ${s.name}`, async () => {
          await uninstallScript({ name: s.name });
        });
      }
    }).catch((e) => log("warn", "deferred per-script command registration failed", e));
  }

  /* ---------- init ---------- */
  function init() {
    log("info", `v${VERSION} starting (manifest: ${MANIFEST_URL})`);
    registerCommands();
    // Background check for updates (non-blocking)
    setTimeout(() => {
      checkForUpdates().catch((e) => log("warn", "background check failed", e));
    }, 5000);
    log("info", "ready — open command palette: 'Update Roam JS'");
  }
  init();
})();
