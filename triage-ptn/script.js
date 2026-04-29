/* triage-ptn v1.1.0
 *
 * v1.1.0 — Log bloat fix + unified settings page (parity with
 * auto-attribute-todo v1.7.4):
 *   (a) Date-bucketed log: instead of appending one block per processed
 *       item directly under [[Triage PTN Log]] (which grew to 62083 words
 *       / 153+ children unbounded), entries now nest under a daily parent
 *       block "[[April 28th, 2026]]" on the log page. Roam handles big
 *       trees better when nested + collapsable.
 *   (b) Auto-archive: entries older than `log_retention_days` (default 30)
 *       are moved to a child page like [[Triage PTN Log/Archive 2026-Q1]]
 *       on each scan cycle. Keeps the live page lean.
 *   (c) Compact-existing cmd: one-time backfill that takes the 153+ flat
 *       child blocks already on the page and groups them under date
 *       parents based on the [[Month Dth, YYYY]] prefix in each entry.
 *   (d) Unified settings page [[Triage PTN Settings]] — same key:: value
 *       block pattern as auto-attribute-todo v1.7.4. Every toggle is
 *       editable inline; the script picks up changes on the next 20-min
 *       scan or instantly via "reload settings from graph".
 *   (e) Robustness: idempotent registerCommands (removeCommand →
 *       addCommand), auto-cleanup of previous version on init, race-
 *       window guard in processBlock (re-check hasTriageSuggestion after
 *       LLM call before insert).
 *
 * v1.0.5 — fence-collision fix in regex source.
 * v1.0.4 — log entries use plain [uid] text (not ((uid)) refs).
 * v1.0.3 — stop retry loop; mark uid attempted-today before LLM call.
 * v1.0.0 — Initial: watch #ptn blocks, classify via LiveAI_API, insert
 *          one suggestion child block. Classifications: task | journal |
 *          decision | reference | obsolete.
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.1.0";
  const NAMESPACE = "triage-ptn";
  const TAG_PAGE = "ptn";
  const LOG_PAGE = "Triage PTN Log";
  const SETTINGS_PAGE = "Triage PTN Settings";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 8000,            // mobile capture often comes in bursts; wait
    minTextLength: 8,
    dailyCallCap: 80,
    scanIntervalMs: 20 * 60_000,  // safety scan every 20 min
    scanBudgetPerCycle: 10,
    contextPages: ["Time Block Constraints", "Chief of Staff/Memory"],
    // v1.1.0: log retention
    logRetentionDays: 30,         // entries older than this get archived
    autoArchiveOnScan: true,      // run archive sweep each scan cycle
  };

  const state = {
    settings: { ...DEFAULTS },
    pending: new Map(),
    processedToday: new Set(),
    callsToday: 0,
    callsResetDate: new Date().toDateString(),
    scanTimer: null,
    pullWatchUnsub: null,
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;

  function loadProcessed() {
    const today = new Date().toDateString();
    try {
      const stored = JSON.parse(localStorage.getItem(sk("processed")) || "{}");
      return stored.date === today ? new Set(stored.uids) : new Set();
    } catch { return new Set(); }
  }
  function persistProcessed() {
    localStorage.setItem(sk("processed"), JSON.stringify({
      date: new Date().toDateString(),
      uids: Array.from(state.processedToday),
    }));
  }
  function resetCallsIfNewDay() {
    const today = new Date().toDateString();
    if (state.callsResetDate !== today) {
      state.callsToday = 0;
      state.callsResetDate = today;
    }
  }

  /* ---------- Settings persistence ---------- */
  function loadPersistentSettings() {
    try {
      const raw = localStorage.getItem(sk("settings"));
      if (!raw) return;
      const stored = JSON.parse(raw);
      for (const [graphKey, settingsKey, type] of GRAPH_SETTINGS) {
        if (stored[settingsKey] !== undefined) {
          state.settings[settingsKey] = stored[settingsKey];
        }
      }
    } catch (e) {
      log("warn", "loadPersistentSettings failed", e);
    }
  }
  function persistSettings() {
    try {
      const obj = {};
      for (const [, settingsKey] of GRAPH_SETTINGS) {
        obj[settingsKey] = state.settings[settingsKey];
      }
      localStorage.setItem(sk("settings"), JSON.stringify(obj));
    } catch (e) {
      log("warn", "persistSettings failed", e);
    }
  }

  /* ---------- Graph settings page (same shape as auto-attribute v1.7.4) ---------- */
  const GRAPH_SETTINGS = [
    // [graphKey, settingsKey, type, default, description]
    ["enabled",                "enabled",            "bool", true,  "Master switch. false = the script ignores #ptn blocks."],
    ["auto_archive_on_scan",   "autoArchiveOnScan",  "bool", true,  "Each 20-min scan moves entries older than retention into an archive child page."],
    ["log_retention_days",     "logRetentionDays",   "int",  30,    "Days of log entries to keep on the live page. Older entries archive automatically."],
    ["daily_call_cap",         "dailyCallCap",       "int",  80,    "Max LLM classifications per day."],
    ["debounce_ms",            "debounceMs",         "int",  8000,  "ms to wait after a #ptn block is created/edited before classifying."],
    ["scan_budget_per_cycle",  "scanBudgetPerCycle", "int",  10,    "Max blocks processed per 20-min scan cycle."],
    ["min_text_length",        "minTextLength",      "int",  8,     "Skip blocks shorter than this (avoids triaging garbage)."],
  ];

  function parseSettingValue(type, raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (type === "bool") {
      const lower = s.toLowerCase();
      return lower === "true" || lower === "yes" || lower === "on" || lower === "1" || lower === "y";
    }
    if (type === "int") {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    }
    if (type === "float") {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    }
    return s;
  }

  function formatSettingValue(type, value) {
    if (type === "bool") return value ? "true" : "false";
    return String(value);
  }

  function loadAllSettingsFromGraph() {
    try {
      const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?s
         :where
         [?p :node/title "${safeName}"]
         [?b :block/page ?p]
         [?b :block/string ?s]]
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
    } catch (e) {
      log("debug", "loadAllSettingsFromGraph failed", e);
      return 0;
    }
  }

  async function ensureSettingsBlock(pageUid, graphKey, type, currentValue, description, order) {
    const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
    const rows = window.roamAlphaAPI.data.q(`
      [:find ?u
       :where
       [?p :node/title "${safeName}"]
       [?b :block/page ?p]
       [?b :block/uid ?u]
       [?b :block/string ?s]
       [(clojure.string/starts-with? ?s "${graphKey}::")]]
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
        [:find ?u
         :where
         [?p :node/title "${safeName}"]
         [?b :block/page ?p]
         [?b :block/uid ?u]
         [?b :block/string ?s]
         [(clojure.string/starts-with? ?s "${graphKey}::")]]
      `);
      const blockUid = rows?.[0]?.[0];
      if (!blockUid) return;
      await window.roamAlphaAPI.data.block.update({
        block: { uid: blockUid, string: `${graphKey}:: ${formatSettingValue(type, value)}` },
      });
    } catch (e) {
      log("debug", `persistSettingToGraph(${graphKey}) failed`, e?.message || e);
    }
  }

  async function ensureSettingsPage(openInSidebar = true) {
    const safeName = SETTINGS_PAGE.replaceAll('"', '\\"');
    let pageUid;
    try {
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?u
         :where
         [?p :node/title "${safeName}"]
         [?p :block/uid ?u]]
      `);
      pageUid = rows?.[0]?.[0];
    } catch {}
    if (!pageUid) {
      pageUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.page.create({
        page: { title: SETTINGS_PAGE, uid: pageUid },
      });
    }
    const headerRows = window.roamAlphaAPI.data.q(`
      [:find ?u
       :where
       [?p :node/title "${safeName}"]
       [?b :block/page ?p]
       [?b :block/uid ?u]
       [?b :block/string ?s]
       [(clojure.string/starts-with? ?s "**How to use this page**")]]
    `);
    if (!headerRows?.[0]?.[0]) {
      const headerUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": pageUid, order: 0 },
        block: { uid: headerUid, string: "**How to use this page** — every setting below is `key:: value`. Edit the value inline (click the block, change the text, click out). The script reloads from this page every 20 min, or instantly via cmd palette → \"Triage PTN: reload settings from graph\". Bool keys: `true` or `false`. Numbers as plain digits." },
      });
    }
    let order = 1;
    for (const [graphKey, settingsKey, type, , description] of GRAPH_SETTINGS) {
      await ensureSettingsBlock(pageUid, graphKey, type, state.settings[settingsKey], description, order);
      order++;
    }
    if (openInSidebar) {
      try {
        await window.roamAlphaAPI.ui.rightSidebar.addWindow({
          window: { type: "outline", "block-uid": pageUid },
        });
      } catch (e) {
        try { await window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: pageUid } }); } catch {}
      }
    }
    return pageUid;
  }

  /* ---------- date helpers ---------- */
  function ordinal(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }
  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  function formatRoamDate(off = 0) {
    const d = new Date(); d.setDate(d.getDate() + off);
    return `[[${MONTHS[d.getMonth()]} ${d.getDate()}${ordinal(d.getDate())}, ${d.getFullYear()}]]`;
  }
  function todayDateLink() {
    return formatRoamDate(0);
  }
  function parseRoamDateLink(s) {
    // "[[April 28th, 2026]]" → Date object, or null
    const m = s.match(/\[\[([A-Z][a-z]+) (\d+)(?:st|nd|rd|th), (\d{4})\]\]/);
    if (!m) return null;
    const monthIdx = MONTHS.indexOf(m[1]);
    if (monthIdx < 0) return null;
    return new Date(parseInt(m[3], 10), monthIdx, parseInt(m[2], 10));
  }
  function quarterTag(d) {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }

  /* ---------- Roam pulls ---------- */
  function getBlock(uid) {
    return window.roamAlphaAPI.data.pull(
      "[:block/string :block/uid {:block/children [:block/string]}]",
      [":block/uid", uid]
    );
  }
  function hasTriageSuggestion(blockData) {
    return (blockData?.[":block/children"] || []).some(
      (c) => (c[":block/string"] || "").startsWith("triage::")
    );
  }
  function findPtnBlocks() {
    try {
      return window.roamAlphaAPI.data.q(`
        [:find ?uid
         :where
         [?b :block/uid ?uid]
         [?b :block/refs ?p]
         [?p :node/title "${TAG_PAGE}"]]
      `).flat();
    } catch (e) {
      log("warn", "ptn query failed", e);
      return [];
    }
  }

  /* ---------- LLM classification ---------- */
  async function classify(uid, text) {
    if (!window.LiveAI_API?.isAvailable()) return null;
    resetCallsIfNewDay();
    if (state.callsToday >= state.settings.dailyCallCap) {
      log("warn", `daily cap reached`); return null;
    }
    const systemPrompt = `Classify a mobile-captured block (#ptn = "process this now") into one of:

- "task" — actionable, has a verb, the user must do something
- "journal" — feeling, reflection, observation, status note
- "decision" — choice made, rationale, commitment
- "reference" — fact, link, quote, lookup material
- "obsolete" — already resolved, duplicate, or trivially short

Output ONLY JSON:
{"classification": "task"|"journal"|"decision"|"reference"|"obsolete",
 "suggested_action": "<one sentence on what to do — for tasks, suggest project/due/priority; for decisions, suggest the destination page; for references, suggest a wiki page; for obsolete, suggest delete>",
 "confidence": <0-1>}

Use [[Time Block Constraints]] and [[Chief of Staff/Memory]] in your context to ground recommendations in active projects and working hours.`;

    try {
      state.callsToday++;
      const r = await window.LiveAI_API.generate({
        prompt: `Block:\n"${text}"\n\nClassify and recommend a route. Return ONLY the JSON, no markdown fences, no prose.`,
        systemPrompt,
        useDefaultSystemPrompt: false,
        roamContext: {
          block: true, blockArgument: [uid], path: true,
          pageArgument: state.settings.contextPages,
        },
        responseFormat: "text",
        temperature: 0.3,
        caller: `${NAMESPACE}/${VERSION}`,
      });
      return parseJsonResponse(r.text);
    } catch (e) {
      log("error", `classify failed (${uid})`, e);
      return null;
    }
  }

  function parseJsonResponse(text) {
    if (!text || typeof text !== "string") return null;
    let s = text.trim();
    const FENCE = "`".repeat(3);
    if (s.startsWith(FENCE)) {
      const re1 = new RegExp("^" + FENCE + "(?:json|JSON)?\\s*\\n?");
      const re2 = new RegExp("\\n?" + FENCE + "\\s*$");
      s = s.replace(re1, "").replace(re2, "");
    }
    try { return JSON.parse(s); } catch {}
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }

  async function insertSuggestion(parentUid, classification) {
    const summary = `triage:: **${classification.classification}** (conf ${(classification.confidence ?? 0).toFixed(2)}) — ${classification.suggested_action}`;
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": parentUid, order: 0 },
      block: { string: summary },
    });
  }

  /* ---------- v1.1.0: date-bucketed log ---------- */
  async function getOrCreateLogPage() {
    const safeName = LOG_PAGE.replaceAll('"', '\\"');
    let pageUid = window.roamAlphaAPI.q(
      `[:find ?u . :where [?p :node/title "${safeName}"] [?p :block/uid ?u]]`
    );
    if (!pageUid) {
      pageUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.page.create({
        page: { title: LOG_PAGE, uid: pageUid },
      });
    }
    return pageUid;
  }

  // Find the date-bucket parent block for `dateLink` on the log page; create
  // it (at order 0 — newest date on top) if absent.
  async function getOrCreateDateBucket(logPageUid, dateLink) {
    const safeName = LOG_PAGE.replaceAll('"', '\\"');
    const rows = window.roamAlphaAPI.data.q(`
      [:find ?u
       :where
       [?p :node/title "${safeName}"]
       [?b :block/page ?p]
       [?b :block/parents ?p]
       [?b :block/uid ?u]
       [?b :block/string "${dateLink.replaceAll('"', '\\"')}"]]
    `);
    if (rows?.[0]?.[0]) return rows[0][0];
    const bucketUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": logPageUid, order: 0 },
      block: { uid: bucketUid, string: dateLink, open: false },
    });
    return bucketUid;
  }

  async function logToRoam(uid, classification, error) {
    try {
      const logPageUid = await getOrCreateLogPage();
      const bucketUid = await getOrCreateDateBucket(logPageUid, todayDateLink());
      const ts = new Date().toISOString().slice(11, 19);
      const summary = error
        ? `${ts} FAIL [${uid}]: ${error}`
        : `${ts} [${uid}] → ${classification.classification} (conf ${(classification.confidence ?? 0).toFixed(2)})`;
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": bucketUid, order: "last" },
        block: { string: summary },
      });
    } catch (e) { log("warn", "log failed", e); }
  }

  /* One-time: take all FLAT children directly under [[Triage PTN Log]]
   * (legacy v1.0.x format) and group them under date-bucket parent blocks
   * based on the [[Month Dth, YYYY]] prefix in each entry's string. */
  async function compactExistingLog() {
    const safeName = LOG_PAGE.replaceAll('"', '\\"');
    const rows = window.roamAlphaAPI.data.q(`
      [:find ?u ?s ?o
       :where
       [?p :node/title "${safeName}"]
       [?b :block/page ?p]
       [?b :block/parents ?p]
       [?b :block/uid ?u]
       [?b :block/string ?s]
       [?b :block/order ?o]]
    `);
    if (!rows.length) return { moved: 0, buckets: 0 };
    // Skip blocks that ARE date buckets themselves (string is exactly "[[...]]")
    const flatEntries = rows.filter(r => !/^\[\[[A-Z][a-z]+ \d+\w+, \d{4}\]\]\s*$/.test(r[1]));
    if (!flatEntries.length) return { moved: 0, buckets: 0 };
    if (!confirm(`Compact ${flatEntries.length} flat log entries into date buckets?\n\nThis nests them under [[Month Dth, YYYY]] parent blocks based on the date prefix in each entry. Reversible by Cmd+Z if needed.`)) {
      return { moved: 0, buckets: 0, cancelled: true };
    }
    const logPageUid = await getOrCreateLogPage();
    let moved = 0;
    const bucketsCreated = new Set();
    for (const [uid, str] of flatEntries) {
      const m = str.match(/^(\[\[[A-Z][a-z]+ \d+\w+, \d{4}\]\])\s+(.*)$/);
      if (!m) continue;
      const dateLink = m[1];
      const rest = m[2];
      const bucketUid = await getOrCreateDateBucket(logPageUid, dateLink);
      bucketsCreated.add(dateLink);
      try {
        // Move the block under the bucket and strip the date prefix from string
        await window.roamAlphaAPI.data.block.move({
          location: { "parent-uid": bucketUid, order: "last" },
          block: { uid },
        });
        await window.roamAlphaAPI.data.block.update({
          block: { uid, string: rest },
        });
        moved++;
      } catch (e) {
        log("warn", `compact: move ${uid} failed`, e?.message || e);
      }
    }
    return { moved, buckets: bucketsCreated.size };
  }

  /* Sweep: any date-bucket block on [[Triage PTN Log]] whose date is older
   * than logRetentionDays gets MOVED to a quarterly archive page. */
  async function archiveOldBuckets() {
    const safeName = LOG_PAGE.replaceAll('"', '\\"');
    const rows = window.roamAlphaAPI.data.q(`
      [:find ?u ?s
       :where
       [?p :node/title "${safeName}"]
       [?b :block/page ?p]
       [?b :block/parents ?p]
       [?b :block/uid ?u]
       [?b :block/string ?s]]
    `);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - state.settings.logRetentionDays);
    let archived = 0;
    const movedToPage = {};
    for (const [uid, str] of rows) {
      const date = parseRoamDateLink(str);
      if (!date) continue; // not a date bucket
      if (date >= cutoff) continue; // still in retention window
      const archivePageTitle = `${LOG_PAGE}/Archive ${quarterTag(date)}`;
      let archivePageUid = movedToPage[archivePageTitle];
      if (!archivePageUid) {
        const safeArchive = archivePageTitle.replaceAll('"', '\\"');
        archivePageUid = window.roamAlphaAPI.q(
          `[:find ?u . :where [?p :node/title "${safeArchive}"] [?p :block/uid ?u]]`
        );
        if (!archivePageUid) {
          archivePageUid = window.roamAlphaAPI.util.generateUID();
          await window.roamAlphaAPI.data.page.create({
            page: { title: archivePageTitle, uid: archivePageUid },
          });
        }
        movedToPage[archivePageTitle] = archivePageUid;
      }
      try {
        await window.roamAlphaAPI.data.block.move({
          location: { "parent-uid": archivePageUid, order: "last" },
          block: { uid },
        });
        archived++;
      } catch (e) {
        log("warn", `archive: move ${uid} failed`, e?.message || e);
      }
    }
    if (archived > 0) {
      log("info", `archived ${archived} date-bucket(s) older than ${state.settings.logRetentionDays}d`);
    }
    return archived;
  }

  /* ---------- main ---------- */
  async function processBlock(uid) {
    state.pending.delete(uid);
    if (state.processedToday.has(uid)) return;
    const data = getBlock(uid);
    if (!data) return;
    const text = data[":block/string"] || "";
    if (text.length < state.settings.minTextLength) return;
    if (hasTriageSuggestion(data)) {
      state.processedToday.add(uid);
      persistProcessed();
      return;
    }
    log("info", `triaging ((${uid})) "${text.slice(0, 60)}"`);
    state.processedToday.add(uid);
    persistProcessed();

    const c = await classify(uid, text);
    if (!c) { await logToRoam(uid, null, "no result"); return; }
    // v1.1.0: race-window guard. The LLM call took ~5s. In that window
    // another runner (parallel scan, ghost cmd, pull-watch) may have
    // already inserted a triage:: suggestion. Re-check before insert.
    const dataAfter = getBlock(uid);
    if (dataAfter && hasTriageSuggestion(dataAfter)) {
      log("info", `[${uid}] already has triage:: suggestion after LLM call — skipping insert (race avoided)`);
      return;
    }
    try {
      await insertSuggestion(uid, c);
      await logToRoam(uid, c, null);
    } catch (e) {
      log("error", `insert failed`, e);
      await logToRoam(uid, c, e.message);
    }
  }

  function schedule(uid) {
    if (state.pending.has(uid)) clearTimeout(state.pending.get(uid));
    state.pending.set(uid, setTimeout(() => processBlock(uid), state.settings.debounceMs));
  }

  function startScan() {
    state.scanTimer = setInterval(() => {
      if (!state.settings.enabled) return;
      // v1.1.0: pick up any setting the user changed inline on the settings page
      loadAllSettingsFromGraph();
      // v1.1.0: archive old log buckets each cycle
      if (state.settings.autoArchiveOnScan) {
        archiveOldBuckets().catch(e => log("warn", "auto-archive failed", e?.message || e));
      }
      const uids = findPtnBlocks();
      let queued = 0;
      const budget = state.settings.scanBudgetPerCycle;
      for (const uid of uids) {
        if (queued >= budget) break;
        if (state.processedToday.has(uid) || state.pending.has(uid)) continue;
        const data = getBlock(uid);
        if (!data || hasTriageSuggestion(data)) continue;
        if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
        schedule(uid);
        queued++;
      }
      if (queued > 0) log("info", `scan queued ${queued}/${budget}`);
    }, state.settings.scanIntervalMs);
  }

  function startPullWatch() {
    try {
      const tagUid = window.roamAlphaAPI.q(
        `[:find ?u . :where [?p :node/title "${TAG_PAGE}"] [?p :block/uid ?u]]`
      );
      if (!tagUid) {
        log("warn", `[[${TAG_PAGE}]] page not found — scan-only mode`);
        return;
      }
      const cb = (before, after) => {
        if (!state.settings.enabled) return;
        const beforeIds = new Set(((before?.[":block/_refs"]) || []).map(r => r[":db/id"]));
        for (const ref of (after?.[":block/_refs"]) || []) {
          if (beforeIds.has(ref[":db/id"])) continue;
          const refData = window.roamAlphaAPI.data.pull("[:block/uid]", ref[":db/id"]);
          if (refData?.[":block/uid"]) schedule(refData[":block/uid"]);
        }
      };
      window.roamAlphaAPI.data.addPullWatch("[:block/_refs]", [":block/uid", tagUid], cb);
      state.pullWatchUnsub = () =>
        window.roamAlphaAPI.data.removePullWatch("[:block/_refs]", [":block/uid", tagUid], cb);
      log("info", `pullwatch on [[${TAG_PAGE}]] registered`);
    } catch (e) { log("warn", "pullwatch failed", e); }
  }

  function registerCommands() {
    // Idempotent: removeCommand → addCommand, so re-pasting the script
    // REPLACES old commands instead of doubling them up.
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
      const status = state.settings[settingsKey] ? "ON" : "OFF";
      log("info", `${descriptor}: ${status}`);
    };

    add("Triage PTN: process focused block now", async () => {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (!f) return log("info", "no focused");
      state.processedToday.delete(f["block-uid"]);
      await processBlock(f["block-uid"]);
    });
    add("Triage PTN: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("Triage PTN: toggle auto-archive on scan", toggleSetting("auto_archive_on_scan", "autoArchiveOnScan", "autoArchiveOnScan"));
    add("Triage PTN: scan now", () => {
      const uids = findPtnBlocks();
      let q = 0;
      const budget = state.settings.scanBudgetPerCycle;
      for (const uid of uids) {
        if (q >= budget) break;
        if (state.processedToday.has(uid) || state.pending.has(uid)) continue;
        const data = getBlock(uid);
        if (!data || hasTriageSuggestion(data)) continue;
        if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
        schedule(uid); q++;
      }
      log("info", `manual scan queued ${q}/${budget}`);
    });
    add("Triage PTN: open settings page (edit toggles inline)", async () => {
      try {
        await ensureSettingsPage(true);
        log("info", `Settings page opened in right sidebar`);
      } catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("Triage PTN: reload settings from graph", () => {
      const updated = loadAllSettingsFromGraph();
      log("info", updated > 0 ? `${updated} setting(s) reloaded` : "no setting changes detected");
    });
    add("Triage PTN: compact existing log into date buckets (one-time)", async () => {
      try {
        const result = await compactExistingLog();
        if (result.cancelled) return;
        const msg = `Compacted ${result.moved} flat entries into ${result.buckets} date bucket(s).`;
        log("info", msg);
        alert(msg);
      } catch (e) {
        log("error", "compact failed", e);
        alert("Compact failed: " + e.message);
      }
    });
    add("Triage PTN: archive old log buckets now", async () => {
      try {
        const archived = await archiveOldBuckets();
        const msg = `Archived ${archived} date-bucket(s) older than ${state.settings.logRetentionDays} days.`;
        log("info", msg);
        alert(msg);
      } catch (e) {
        log("error", "archive failed", e);
        alert("Archive failed: " + e.message);
      }
    });
    add("Triage PTN: emergency stop", () => {
      state.settings.enabled = false;
      try { cleanup(); } catch (e) { log("warn", "cleanup err", e); }
      log("info", "EMERGENCY STOP — disabled. Refresh page to restart.");
    });
    add("Triage PTN: clear processedToday cache", () => {
      state.processedToday = new Set();
      persistProcessed();
      log("info", "processedToday cleared");
    });
    add("Triage PTN: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `triage-ptn v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.autoArchiveOnScan)} auto-archive on scan`,
        ``,
        `── runtime ──`,
        `  LLM calls today: ${state.callsToday} / ${state.settings.dailyCallCap}`,
        `  Processed today: ${state.processedToday.size}`,
        `  Pending debounce: ${state.pending.size}`,
        `  Log retention: ${state.settings.logRetentionDays} days`,
        `  LiveAI available: ${!!window.LiveAI_API?.isAvailable()}`,
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });
  }

  function init() {
    log("info", `v${VERSION} starting`);
    // v1.1.0: kill any prior version of this script that's still running in
    // this tab (re-paste of roam/js block leaves old timers, watchers, and
    // cmd palette commands alive — they closure over old state).
    const priorCleanup = window[`${NAMESPACE}_cleanup`];
    if (typeof priorCleanup === "function") {
      try {
        priorCleanup();
        log("info", "cleaned up prior version's timers/watchers/commands");
      } catch (e) {
        log("warn", "prior cleanup threw, continuing anyway", e?.message || e);
      }
    }
    state.processedToday = loadProcessed();
    loadPersistentSettings();
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      .catch(e => log("warn", "settings page bootstrap failed", e?.message || e));
    registerCommands();
    startPullWatch();
    startScan();
    window[`${NAMESPACE}_state`] = state;
    log("info", `ready. ${state.processedToday.size} already processed today.`);
  }

  function cleanup() {
    if (state.scanTimer) clearInterval(state.scanTimer);
    if (state.pullWatchUnsub) try { state.pullWatchUnsub(); } catch {}
    for (const t of state.pending.values()) clearTimeout(t);
    state.pending.clear();
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
