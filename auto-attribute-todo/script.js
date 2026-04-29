/* auto-attribute-todo v1.7.4
 *
 * v1.7.4 — Unified settings page. Every user-controllable setting now lives
 * on [[Auto-Attribute Settings]] as a `key:: value` block (one block per
 * setting; the value is editable inline). Graph is the source of truth;
 * localStorage is a write-through cache for fast init. Toggles flipped via
 * cmd palette write back to the graph block, so the page always reflects
 * current state — answers "is auto-create on right now?" with one glance.
 *   New cmd palette commands: "open settings page (edit toggles inline)"
 * (opens the page in the right sidebar) and "show stats (current settings)"
 * (alert + console with a clear ON/OFF panel for every toggle).
 *   Backward compatible: old localStorage-backed settings still load. Old
 * gemini_api_key:: block is now part of the broader settings page, no
 * migration needed.
 *
 * v1.7.3 — THREE fixes from real-world breakage:
 *   (a) **Ghost cmd palette commands**. Roam doesn't unregister cmd palette
 *       commands when you re-paste a roam/js block — the OLD version's
 *       commands (closure over old state) keep firing alongside the new
 *       ones. Symptom: rebuild command kept hitting text-embedding-004
 *       even after v1.7.2 was pasted, because v1.7.1's command was still
 *       wired up. Fix: registerCommands now calls removeCommand before
 *       addCommand for each label (idempotent). And init() auto-calls the
 *       previous version's cleanup() if a window namespace marker exists.
 *   (b) **Duplicate BT_attr children** (e.g. two BT_attrDue, two
 *       BT_attrPriority on the same TODO). Caused by parallel attribute()
 *       runs from ghost commands + race between debounce-fire and pull-
 *       watch-fire. Three-layer fix: (1) processedToday lock at very top of
 *       processBlock; (2) re-fetch + re-check hasBTProject after LLM call,
 *       before insertAttrs; (3) insertAttrs skips any BT_attrX:: key that
 *       already exists as a child. Plus new cmd palette command "dedupe
 *       BT_attr children (cleanup)" to scrub existing duplicates from the
 *       graph in one pass.
 *   (c) **Embedding model auto-discovery**. The hardcoded fallback chain
 *       could go fully stale if Google rotates ALL listed models at once.
 *       Added discoverEmbeddingModels() that calls
 *       https://generativelanguage.googleapis.com/v1beta/models?key=... and
 *       filters for supportedGenerationMethods includes embedContent. On
 *       any 404 from callGeminiEmbed, the script discovers what's actually
 *       available, repopulates embeddingModelFallbacks from that list, and
 *       retries. Self-heals across any future Gemini model rotation without
 *       a code change. New cmd palette command "discover available
 *       embedding models" surfaces the live list for debugging.
 *
 * v1.7.2 — Gemini embedding model rotation. text-embedding-004 was retired;
 * default is now gemini-embedding-001. Added a fallback chain
 * (gemini-embedding-001 → text-embedding-005 → text-embedding-004) — on a
 * 404, the script walks the chain and promotes the first working model to
 * be the new default for the session.
 *
 * v1.7.1 — Roam-native key input. Replaced window.prompt() with a graph page
 * `[[Auto-Attribute Settings]]` containing a `gemini_api_key:: <key>` block.
 * Reason: Roam Desktop (Electron) blocks window.prompt() — the dialog never
 * appears. The new flow opens the settings page in the right sidebar with a
 * placeholder block; user pastes their key into the block; the script picks
 * it up on next scan cycle (or instantly via "reload Gemini key from graph"
 * cmd palette command). Settings persist in BOTH localStorage AND the graph
 * — graph is source of truth, localStorage is cache for fast init.
 *
 * v1.7.0 — Phase 3: semantic embedding ranker. Projects + TODOs are embedded
 * via Gemini text-embedding-004 (768-dim). On each TODO process, the script
 * embeds the TODO text + breadcrumb, cosine-sims against cached project
 * embeddings, and feeds the top-K (default 5) to the LLM as the candidate
 * list — replacing graph-Jaccard pre-ranking when embeddings are available
 * (graph-Jaccard score is preserved as a tie-breaker, weight 0.2). Catches
 * semantic relevance that lexical/Jaccard methods miss (e.g. a TODO about
 * "running an audit" matches a project tagged "compliance review" even with
 * no shared page-refs). Cache: IndexedDB keyed by project page name +
 * SHA-256 short hash of (aliases + page text); stale cache auto-refreshes
 * on hash mismatch during the 15-min scan cycle. Gracefully falls back to
 * v1.6.0 graph-Jaccard if no Gemini key is set, embeddings disabled, network
 * fails, or Gemini quota hits — Phase 3 is purely additive.
 *   Architecture decision: Gemini direct API (768-dim, ~$0 ongoing on free
 * tier 1500 RPD) over TF.js Universal Sentence Encoder. Avoids 10MB model
 * download, avoids 30-50MB JS heap pressure, identical browser+desktop+
 * mobile behavior. LiveAI doesn't proxy embeddings (verified 2026-04-27);
 * user supplies their own Gemini key.
 *
 * v1.6.0 — Project lifecycle commands. Archive a project (sets
 * Project Status:: Archive, auto-removes from dropdown), unarchive (flip
 * back to Active), list-by-status. Picker uses prompt() with the active
 * list shown. The hub auto-syncs after every transition so dropdown
 * reflects the change immediately.
 *
 * v1.5.0 — Phase 2: smarter project matching + correction learning:
 *   (a) Strip the auto-maintained comment block from [[Active Projects]] hub —
 *       Universal Selector was including it as a dropdown option. Hub now
 *       only contains [[Project Name]] links, no description text.
 *   (b) Graph-Jaccard pre-ranking: for each TODO, collect [[Page]] refs from
 *       the block + breadcrumb. For each active project, collect refs from
 *       its page + recent backlinks. Compute Jaccard similarity. Top-10
 *       projects by score get a graph_score boost in the LLM prompt + a
 *       "graph signal" comment so the LLM knows which projects are
 *       structurally connected to this TODO. Smaller prompt, better recall.
 *   (c) Correction learning: when user manually changes a BT_attrProject
 *       value (via Universal Selector dropdown or manual edit), the script
 *       detects (AIpick → userPick) via pull-watch, logs to
 *       [[Auto-Attribute Corrections]] page. The last 10 corrections are
 *       included as few-shot examples in the LLM prompt for future TODOs.
 *       True RLHF-style learning loop. Survives page reload via localStorage
 *       rehydration.
 *
 * v1.4.0 — FIVE refinements based on real-world usage:
 *   (a) Active Projects hub query was too loose — matched ANY block containing
 *       "Project Status:: Active" (e.g. comments referencing the convention).
 *       Now uses strict `starts-with "Project Status:: Active"` AND filters
 *       out daily pages + roam/* system pages + the hub itself.
 *   (b) Recognize "Active" AND "Ongoing" both as valid project states. Other
 *       statuses (Done, Archive, etc.) excluded from the dropdown pool.
 *   (c) Auto-create projects ON BY DEFAULT (was opt-in). Toggle off via
 *       "Auto-Attribute: toggle auto-create projects".
 *   (d) Debounce default 30s → 5s — user types thoughts first, then converts
 *       to TODO, so the long delay was wasted patience.
 *   (e) Sync hub immediately after auto-create (new project appears in
 *       dropdowns instantly, not on next 15-min scan).
 *
 * v1.3.0 — TWO new features:
 *   (a) Auto-maintained [[Active Projects]] hub page that mirrors current
 *       Project Status:: Active set. Dropdown source switches to this hub
 *       (+[[Active Projects]]) so the dropdown ALWAYS reflects active state
 *       — new projects appear immediately, completed ones disappear.
 *       Sync runs on each scan cycle (~15 min) and on cmd palette demand.
 *   (b) Auto-create projects when AI suggests one (off by default — toggle
 *       via cmd palette). Conservative: confidence >= 0.7 required, max 5
 *       new projects per day. New page gets Project Status:: Active block
 *       and an Aliases:: block seeded from the TODO text. Logged loudly.
 *
 * v1.2.1 — TWO FIXES:
 * 1. ALWAYS emit dropdown when project is set (was: only when LLM returned 2+
 *    candidates). Single AI pick now writes
 *    `BT_attrProject:: {{or: [[AIpick]] | +attr:[[BT_attrProject]]}}`
 *    so the user gets a dropdown of all historical project values to pick from.
 *    Multi-candidate keeps the inline list + attr: pool.
 * 2. JS-based clean-text fallback. The LLM's `cleaned_text` field was
 *    inconsistent (Haiku skipped it ~half the time). Now there's a
 *    deterministic regex cleaner that runs after the LLM attempt, stripping
 *    date words when BT_attrDue is set, urgency words when priority=High,
 *    and "for/with [Alias]" patterns when the person is tagged in notes.
 *
 * v1.2.0 — top-3 project candidates emitted as `{{or: [[A]] | [[B]] | [[C]]}}`
 * dropdown syntax in BT_attrProject. Universal Selector extension (if installed)
 * renders this as a filterable dropdown — one click to override the AI's pick.
 * Roam has a native `{{or:}}` fallback if Universal Selector isn't installed.
 * Single-candidate cases keep the flat `[[Project]]` format (no dropdown clutter).
 * Bulk-convert command added for upgrading existing flat BT_attrProject blocks.
 *
 * v1.1.2 — clean redundant hints from the TODO title. After BT_attr children
 * are assigned, if the title contained "tomorrow"/date words, person aliases,
 * or other hints that got captured into attributes, the AI proposes a
 * cleaned title and the script updates the parent block. E.g.:
 *   Before: "{{[[TODO]]}} review plan with sanitation team tomorrow"
 *   After:  "{{[[TODO]]}} review plan with sanitation team"  (since BT_attrDue
 *           captured "tomorrow")
 * Conservative — only cleans when the AI is confident the removed phrase is
 * captured in attributes. Toggle off via "Auto-Attribute: toggle clean-text".
 *
 * v1.1.1 — people / entity aliasing. Reads Aliases:: from ANY page (not
 * just active projects), so when a TODO mentions "Lori" the AI knows to
 * tag [[Lori Boyd]] in the notes for backlink discovery. Log entries also
 * switched back to ((uid)) clickable block-refs (one backlink per TODO per
 * day is bounded since v1.0.3 caps retries).
 *
 * v1.1.0 — context-aware classification. Reads Aliases:: blocks from each
 * active project page (via dive2Pro/roam-aliases convention) so e.g. "Lori"
 * in a TODO maps to project "EMP Risk Matrix" if that project has
 * Aliases:: Lori, Lori Boyd. Also widens roamContext to include the TODO
 * block's children + siblings + 5-level path (was just block + path).
 * Debounce default bumped from 3 sec to 30 sec so you have time to think
 * about a TODO before the AI fires.
 *
 * v1.0.5 — fix script source containing literal triple-backticks in regex
 * patterns (collided with the OUTER markdown fence). All triple-backticks
 * in source replaced with Unicode-escaped equivalents.
 *
 * v1.0.4 — log entries no longer use ((uid)) Roam block-refs (was polluting
 * the source TODO's backlink count). Uses plain `[uid]` text instead.
 *
 * v1.0.3
 *
 * Watches for new {{[[TODO]]}} blocks and auto-fills BT_attr* children
 * (project, due, priority, energy, context) using window.LiveAI_API.
 *
 * Requires: Live AI Assistant extension with "Enable Public API" toggled ON.
 * Install: paste inside a `{{[[roam/js]]}}` block, approve when prompted.
 * Commands: open command palette, type "Auto-Attribute" — manage from there.
 *
 * v1.0.3 — STOP RETRY LOOP. v1.0.2 forgot to add a UID to processedToday
 * when the LLM call failed, so the 5-min safety scan retried the same broken
 * call every 5 min forever. Now: any block we ATTEMPT (success or failure)
 * goes into processedToday so it's skipped on subsequent scans within the
 * same day. User can manually retry via "process focused TODO now".
 *   Also: scan-budget reduced from 25 to 10 per cycle. Safety-scan interval
 *   bumped from 5 min to 15 min.
 *
 * v1.0.2 — fix LLM result parsing: LiveAI's json_object mode requires a
 * `{"response": ...}` wrapper that we don't ask for. Switch to text mode +
 * robust manual parse (strips json-tagged markdown fences if present).
 */
;(function () {
  const VERSION = "1.7.5";
  const NAMESPACE = "auto-attr-todo";
  const LOG_PAGE = "Auto-Attribute TODO Log";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 5000,            // 5 sec — user types thoughts then converts to TODO
    minTextLength: 12,
    confidenceThreshold: 0.6,
    dailyCallCap: 100,
    scanIntervalMs: 15 * 60_000,
    scanBudgetPerCycle: 10,
    contextPages: ["Time Block Constraints", "Chief of Staff/Memory"],
    requireConfirmation: false,
    aliasKeyword: "Aliases",
    contextPathDepth: 5,
    contextChildren: true,
    contextSiblings: true,
    cleanTodoText: true,
    useDropdown: true,
    activeProjectsHub: "Active Projects",
    syncHubOnScan: true,
    autoCreateProjects: true,    // ON by default — toggle off via cmd palette
    autoCreateMinConfidence: 0.7,
    autoCreateDailyCap: 5,
    activeProjectStatuses: ["Active", "Ongoing"],
    correctionsPage: "Auto-Attribute Corrections",
    fewShotCorrectionsCount: 10,  // how many recent corrections to include in LLM prompt
    graphJaccardTopK: 10,         // how many graph-pre-ranked projects to send to LLM
    // ── Phase 3: semantic embedding ranker (v1.7.0) ─────────────────────────
    geminiApiKey: "",             // set via [[Auto-Attribute Settings]] page block
    useEmbeddings: false,         // gated until key is set + manually enabled
    embeddingModel: "gemini-embedding-001", // Gemini's current embedding model
    embeddingModelFallbacks: [          // tried in order on 404 — handles model rotation
      "gemini-embedding-001",
      "text-embedding-005",
      "text-embedding-004",
    ],
    embeddingTopK: 5,             // top-K via cosine before LLM picks final
    embeddingProjectTextChars: 1500, // how much project page text to embed
    embeddingGraphWeight: 0.2,    // tie-breaker weight for graph-Jaccard signal
    settingsPage: "Auto-Attribute Settings", // graph page holding gemini_api_key:: block
  };

  const state = {
    settings: { ...DEFAULTS },
    pending: new Map(),          // uid → debounce timer
    processedToday: new Set(),
    callsToday: 0,
    callsResetDate: new Date().toDateString(),
    pullWatchUnsub: null,
    scanTimer: null,
    projectsCreatedToday: 0,
    trackedAttributions: {},     // {btProjUid: {todoUid, originalPick, todoText, watcherCb}}
    // ── Phase 3 state ─────────────────────────────────────────────────────
    projectEmbeddings: new Map(), // projectName → Float-array vector (in-mem cache)
    idbConn: null,                // cached IndexedDB connection
    embedsBootstrapped: false,
  };

  /* ---------- helpers ---------- */
  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");

  const sk = (k) => `${NAMESPACE}:${k}`;

  function loadProcessed() {
    const today = new Date().toDateString();
    try {
      const stored = JSON.parse(localStorage.getItem(sk("processed")) || "{}");
      if (stored.date !== today) return new Set();
      return new Set(stored.uids);
    } catch { return new Set(); }
  }

  function persistProcessed() {
    localStorage.setItem(sk("processed"), JSON.stringify({
      date: new Date().toDateString(),
      uids: Array.from(state.processedToday),
    }));
  }

  /* v1.7.4: full settings page schema. Every user-controllable setting lives
   * as a `graphKey:: value` block on [[Auto-Attribute Settings]]. The graph
   * is the source of truth (localStorage is a cache for fast init).
   *
   * Format per row: [graphKey, settingsKey, type, default, description].
   * Bool keys parse "true/yes/on/1" → true, anything else → false.
   * Numeric keys parse via parseInt/parseFloat. */
  const GRAPH_SETTINGS = [
    // Core toggles — flip ON/OFF inline
    ["enabled",                "enabled",                "bool",   true,  "Master switch. false = the script ignores all TODOs."],
    ["auto_create_projects",   "autoCreateProjects",     "bool",   true,  "When AI suggests a new project that doesn't exist, auto-create the page (Project Status:: Active)."],
    ["clean_todo_text",        "cleanTodoText",          "bool",   true,  "Rewrite the TODO title to remove hints captured into BT_attr children (e.g. 'tomorrow' → captured in BT_attrDue)."],
    ["use_dropdown",           "useDropdown",            "bool",   true,  "Emit BT_attrProject as {{or:}} dropdown so you can override the AI pick with one click."],
    ["use_embeddings",         "useEmbeddings",          "bool",   false, "Phase 3 semantic ranker. Requires gemini_api_key. Falls back silently to graph-Jaccard if disabled or fails."],
    ["require_confirmation",   "requireConfirmation",    "bool",   false, "Suggestion-only mode. Logs the AI's pick but doesn't write BT_attr children. Useful for evaluating accuracy."],
    ["sync_hub_on_scan",       "syncHubOnScan",          "bool",   true,  "Refresh [[Active Projects]] hub on each 15-min scan cycle. Off = manual only via cmd palette."],
    // Phase 3 secret + tunables
    ["gemini_api_key",         "geminiApiKey",           "string", "",    "Free key at https://aistudio.google.com/apikey — covers 1500 RPD."],
    ["embedding_top_k",        "embeddingTopK",          "int",    5,     "How many top-similarity projects to send to the LLM as candidates. 3-10 reasonable; 5 is the sweet spot."],
    ["embedding_graph_weight", "embeddingGraphWeight",   "float",  0.2,   "Tie-breaker weight for graph-Jaccard score (0 = pure semantic, 1 = pure graph). 0.2 default."],
    // LLM tunables
    ["confidence_threshold",   "confidenceThreshold",    "float",  0.6,   "Below this, BT_attrNotes gets a '(low conf — verify)' suffix prompting you to double-check."],
    ["daily_call_cap",         "dailyCallCap",           "int",    100,   "Max LLM attribution calls per day. Resets at midnight local."],
    ["debounce_ms",            "debounceMs",             "int",    5000,  "ms to wait after a TODO is created/edited before processing. Lets you keep typing."],
    ["auto_create_min_conf",   "autoCreateMinConfidence", "float", 0.7,   "AI must be at least this confident before auto-creating a new project page."],
    ["auto_create_daily_cap",  "autoCreateDailyCap",     "int",    5,     "Max new project pages auto-created per day. Resets at midnight."],
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


  function resetCallsIfNewDay() {
    const today = new Date().toDateString();
    if (state.callsResetDate !== today) {
      state.callsToday = 0;
      state.projectsCreatedToday = 0;
      state.callsResetDate = today;
    }
  }

  function ordinalSuffix(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }

  function formatRoamDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const months = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
    return `[[${months[d.getMonth()]} ${d.getDate()}${ordinalSuffix(d.getDate())}, ${d.getFullYear()}]]`;
  }

  /* ---------- Roam queries ---------- */
  function getBlock(uid) {
    return window.roamAlphaAPI.data.pull(
      "[:block/string :block/uid {:block/children [:block/string]}]",
      [":block/uid", uid]
    );
  }

  const isTodo = (s) => !!s && s.includes("{{[[TODO]]}}");

  function hasBTProject(blockData) {
    const ch = blockData?.[":block/children"] || [];
    return ch.some((c) => (c[":block/string"] || "").startsWith("BT_attrProject::"));
  }

  // Filters for project page candidates
  function isDailyPageTitle(t) {
    return /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(st|nd|rd|th), \d{4}$/.test(t);
  }
  function isSystemPageTitle(t) {
    if (t.startsWith("roam/")) return true;
    if (t === state.settings.activeProjectsHub) return true;
    if (t.startsWith("Chief of Staff/")) return true;
    return false;
  }

  function getActiveProjectsWithAliases() {
    // Returns [{name, aliases: []}, ...] for each page tagged with one of
    // settings.activeProjectStatuses (default: Active, Ongoing).
    // Strict match: block must START with "Project Status:: <status>" (not just
    // contain — that would match comments). Filters daily + system pages.
    try {
      const allRows = [];
      for (const status of state.settings.activeProjectStatuses) {
        const prefix = `Project Status:: ${status}`;
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?title
           :where
           [?p :node/title ?title]
           [?b :block/page ?p]
           [?b :block/string ?s]
           [(clojure.string/starts-with? ?s "${prefix}")]]
        `);
        allRows.push(...rows.flat());
      }
      const projects = [...new Set(allRows)]
        .filter(t => !isDailyPageTitle(t))
        .filter(t => !isSystemPageTitle(t))
        .slice(0, 60);
      const aliasPrefix = state.settings.aliasKeyword + "::";

      return projects.map((title) => {
        let aliases = [];
        try {
          const aliasRows = window.roamAlphaAPI.data.q(`
            [:find ?s
             :where
             [?p :node/title "${title.replaceAll('"', '\\"')}"]
             [?b :block/page ?p]
             [?b :block/string ?s]
             [(clojure.string/starts-with? ?s "${aliasPrefix}")]]
          `);
          const aliasStr = (aliasRows.flat()[0] || "").trim();
          if (aliasStr) {
            aliases = aliasStr
              .substring(aliasPrefix.length)
              .split(",")
              .map(a => a.trim())
              .filter(Boolean);
          }
        } catch {}
        return { name: title, aliases };
      });
    } catch (e) {
      log("warn", "active projects query failed", e);
      return [];
    }
  }

  // Backward-compat shim — some other code might still call getActiveProjects()
  function getActiveProjects() {
    return getActiveProjectsWithAliases().map(p => p.name);
  }

  /* ---------- Graph-Jaccard project pre-ranking (Phase 2) ----------
   * For each TODO, collect [[Page]] refs from block + breadcrumb.
   * For each project page, collect refs from its descendants.
   * Jaccard = |shared| / |union|. Top-K ranked projects go to the LLM
   * with a "graph_score" hint so the LLM knows which are structurally
   * related to this TODO. Catches context the LLM-only path misses. */
  function collectTodoContextRefs(uid) {
    try {
      const data = window.roamAlphaAPI.data.pull(
        `[:block/string
          {:block/refs [:node/title]}
          {:block/parents [{:block/refs [:node/title]} :block/string]}]`,
        [":block/uid", uid]
      );
      const refs = new Set();
      for (const r of (data?.[":block/refs"] || [])) {
        if (r[":node/title"]) refs.add(r[":node/title"]);
      }
      for (const p of (data?.[":block/parents"] || [])) {
        for (const r of (p[":block/refs"] || [])) {
          if (r[":node/title"]) refs.add(r[":node/title"]);
        }
      }
      return refs;
    } catch (e) {
      log("debug", "collectTodoContextRefs failed", e);
      return new Set();
    }
  }

  function collectProjectPageRefs(projectName) {
    try {
      const safeName = projectName.replaceAll('"', '\\"');
      // All blocks ON the project page → their refs
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?title
         :where
         [?p :node/title "${safeName}"]
         [?b :block/page ?p]
         [?b :block/refs ?r]
         [?r :node/title ?title]]
      `);
      return new Set(rows.flat());
    } catch (e) {
      log("debug", `collectProjectPageRefs failed for ${projectName}`, e);
      return new Set();
    }
  }

  function jaccard(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const x of setA) if (setB.has(x)) intersection++;
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function rankProjectsByGraphSignal(todoUid, projects) {
    const todoRefs = collectTodoContextRefs(todoUid);
    if (todoRefs.size === 0) {
      // No context refs — return projects as-is with score 0
      return projects.map(p => ({ ...p, graphScore: 0 }));
    }
    return projects
      .map(p => {
        const projRefs = collectProjectPageRefs(p.name);
        return { ...p, graphScore: jaccard(todoRefs, projRefs) };
      })
      .sort((a, b) => b.graphScore - a.graphScore);
  }

  /* ---------- Phase 3: Semantic embedding ranker (v1.7.0) ----------
   * Embed each active project once via Gemini text-embedding-004 (768-dim),
   * cache in IndexedDB by name + content hash. On each TODO, embed the TODO
   * text + breadcrumb, cosine-sim against cached project vectors, take top-K.
   * Combines with graph-Jaccard (weight 0.2) for tie-breaking. Falls back
   * silently to Phase 2 if no key, network error, or quota hit. */

  const IDB_NAME = "auto-attr-embeddings-v1";
  const IDB_STORE = "projects";

  function openEmbedDB() {
    if (state.idbConn) return Promise.resolve(state.idbConn);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "name" });
      req.onsuccess = () => { state.idbConn = req.result; resolve(state.idbConn); };
      req.onerror = () => reject(req.error);
    });
  }

  function idbReq(mode, op) {
    return openEmbedDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const req = op(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  const idbGetEmbed = (name) => idbReq("readonly", s => s.get(name));
  const idbPutEmbed = (record) => idbReq("readwrite", s => s.put(record));
  const idbGetAllEmbeds = () => idbReq("readonly", s => s.getAll());
  const idbDeleteEmbed = (name) => idbReq("readwrite", s => s.delete(name));

  async function sha256Short(s) {
    const buf = new TextEncoder().encode(s || "");
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
  }

  async function callGeminiEmbedOne(text, model, key) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(`Gemini embed ${resp.status}: ${errText.slice(0, 200)}`);
      err.status = resp.status;
      err.model = model;
      throw err;
    }
    const data = await resp.json();
    const vec = data?.embedding?.values;
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error(`Gemini ${model} returned empty embedding`);
    }
    return vec;
  }

  /* v1.7.3: list models from Google's API and filter for embedContent
   * support. Self-heals across model rotations: if every model in our
   * hardcoded fallback chain is dead, this finds whatever's currently
   * available and updates the chain. */
  async function discoverEmbeddingModels() {
    const key = state.settings.geminiApiKey;
    if (!key) throw new Error("no Gemini API key");
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`listModels ${resp.status}: ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const models = (data?.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods)
        && m.supportedGenerationMethods.includes("embedContent"))
      .map(m => (m.name || "").replace(/^models\//, ""))
      .filter(Boolean);
    return models;
  }

  async function callGeminiEmbed(text) {
    const key = state.settings.geminiApiKey;
    if (!key) throw new Error("no Gemini API key — set via cmd palette");
    // Try the configured model first, then fall back through the chain.
    const tryChain = async (models) => {
      const tried = [];
      let lastErr;
      for (const model of models) {
        if (tried.includes(model)) continue;
        tried.push(model);
        try {
          const vec = await callGeminiEmbedOne(text, model, key);
          if (state.settings.embeddingModel !== model) {
            log("info", `Gemini embedding model updated: ${state.settings.embeddingModel} → ${model} (auto-detected)`);
            state.settings.embeddingModel = model;
          }
          return { vec, lastErr: null, tried };
        } catch (e) {
          lastErr = e;
          if (e.status !== 404) return { vec: null, lastErr, tried };
          log("debug", `embed model ${model} 404, falling back`, e?.message?.slice(0, 100));
        }
      }
      return { vec: null, lastErr, tried };
    };

    const candidates = [
      state.settings.embeddingModel,
      ...state.settings.embeddingModelFallbacks.filter(m => m !== state.settings.embeddingModel),
    ];
    let result = await tryChain(candidates);
    if (result.vec) return result.vec;

    // If everything in the hardcoded chain 404'd, Google rotated all of
    // them. Discover what's actually available and try again.
    if (result.lastErr?.status === 404) {
      try {
        log("warn", "all hardcoded embedding models 404 — discovering live list...");
        const discovered = await discoverEmbeddingModels();
        if (discovered.length > 0) {
          const newChain = discovered.filter(m => !result.tried.includes(m));
          log("info", `discovered ${discovered.length} embedding models; trying ${newChain.length} new ones: ${newChain.join(", ")}`);
          if (newChain.length > 0) {
            state.settings.embeddingModelFallbacks = discovered;
            const result2 = await tryChain(newChain);
            if (result2.vec) return result2.vec;
            result = result2;
          }
        } else {
          log("warn", "no embedding models found in API listModels response");
        }
      } catch (e) {
        log("warn", "discoverEmbeddingModels failed", e?.message || e);
      }
    }
    throw result.lastErr || new Error("Gemini embed: all models failed");
  }

  function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      ma += a[i] * a[i];
      mb += b[i] * b[i];
    }
    if (ma === 0 || mb === 0) return 0;
    return dot / (Math.sqrt(ma) * Math.sqrt(mb));
  }

  function buildProjectEmbedText(projectName, aliases) {
    const safeName = projectName.replaceAll('"', '\\"');
    let blocks = [];
    try {
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?s
         :where
         [?p :node/title "${safeName}"]
         [?b :block/page ?p]
         [?b :block/string ?s]]
      `);
      blocks = rows.flat().filter(s => s && s.length > 0);
    } catch (e) {
      log("debug", `buildProjectEmbedText failed for ${projectName}`, e);
    }
    const aliasLine = aliases?.length ? `Aliases: ${aliases.join(", ")}` : "";
    const parts = [projectName, aliasLine, ...blocks].filter(Boolean);
    return parts.join("\n").slice(0, state.settings.embeddingProjectTextChars);
  }

  async function ensureProjectEmbedding(projectName, aliases) {
    const text = buildProjectEmbedText(projectName, aliases);
    const hash = await sha256Short(text);
    let cached;
    try { cached = await idbGetEmbed(projectName); } catch (e) {
      log("debug", `idbGet failed for ${projectName}`, e);
    }
    if (cached && cached.hash === hash && Array.isArray(cached.vector)) {
      state.projectEmbeddings.set(projectName, cached.vector);
      return cached.vector;
    }
    const vector = await callGeminiEmbed(text);
    try {
      await idbPutEmbed({ name: projectName, hash, vector, ts: Date.now(), aliases: aliases || [] });
    } catch (e) {
      log("warn", `idbPut failed for ${projectName}`, e);
    }
    state.projectEmbeddings.set(projectName, vector);
    return vector;
  }

  async function bootstrapEmbeddings() {
    if (!state.settings.useEmbeddings || !state.settings.geminiApiKey) return;
    if (state.embedsBootstrapped) return;
    state.embedsBootstrapped = true;
    const projects = getActiveProjectsWithAliases();
    log("info", `bootstrapping embeddings for ${projects.length} active projects...`);
    let ok = 0, fail = 0, skip = 0;
    for (const p of projects) {
      try {
        const cachedBefore = state.projectEmbeddings.has(p.name);
        await ensureProjectEmbedding(p.name, p.aliases);
        if (cachedBefore) skip++; else ok++;
      } catch (e) {
        log("warn", `embed bootstrap failed for ${p.name}`, e?.message || e);
        fail++;
      }
      // Throttle 100ms between calls — Gemini free tier handles 10 RPS easily
      await new Promise(r => setTimeout(r, 100));
    }
    log("info", `embeddings bootstrap done: ${ok} new, ${skip} cached, ${fail} failed`);
  }

  async function refreshEmbeddingsIfStale() {
    if (!state.settings.useEmbeddings || !state.settings.geminiApiKey) return;
    const projects = getActiveProjectsWithAliases();
    let refreshed = 0, removed = 0;
    // Refresh stale (hash mismatch) for current active projects
    for (const p of projects) {
      const text = buildProjectEmbedText(p.name, p.aliases);
      const hash = await sha256Short(text);
      let cached;
      try { cached = await idbGetEmbed(p.name); } catch {}
      if (!cached || cached.hash !== hash) {
        try {
          await ensureProjectEmbedding(p.name, p.aliases);
          refreshed++;
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          log("debug", `stale-refresh failed for ${p.name}`, e?.message || e);
        }
      }
    }
    // GC: remove embeddings for projects that are no longer active
    try {
      const all = await idbGetAllEmbeds();
      const activeNames = new Set(projects.map(p => p.name));
      for (const rec of all) {
        if (!activeNames.has(rec.name)) {
          await idbDeleteEmbed(rec.name);
          state.projectEmbeddings.delete(rec.name);
          removed++;
        }
      }
    } catch (e) {
      log("debug", "embedding GC failed", e);
    }
    if (refreshed > 0 || removed > 0) {
      log("info", `embeddings refresh: ${refreshed} updated, ${removed} GC'd`);
    }
  }

  function buildTodoEmbedText(uid, text) {
    let breadcrumb = "";
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/parents [:block/string]}]",
        [":block/uid", uid]
      );
      const parents = data?.[":block/parents"] || [];
      breadcrumb = parents
        .map(p => (p[":block/string"] || "").slice(0, 200))
        .filter(Boolean)
        .join(" > ");
    } catch {}
    return breadcrumb ? `${breadcrumb}\n${text}` : text;
  }

  async function rankProjectsByEmbeddings(todoUid, todoText, projects) {
    if (!state.settings.useEmbeddings || !state.settings.geminiApiKey) return null;
    if (!projects.length) return null;

    const embedInput = buildTodoEmbedText(todoUid, todoText);
    let todoVec;
    try {
      todoVec = await callGeminiEmbed(embedInput);
    } catch (e) {
      log("warn", "TODO embed failed — falling back to graph-Jaccard", e?.message || e);
      return null;
    }

    // Score each project using cached vector; lazy-fill any missing
    const scored = await Promise.all(projects.map(async p => {
      let projVec = state.projectEmbeddings.get(p.name);
      if (!projVec) {
        try {
          projVec = await ensureProjectEmbedding(p.name, p.aliases);
        } catch (e) {
          log("debug", `lazy embed failed for ${p.name}`, e?.message || e);
          projVec = null;
        }
      }
      const embedScore = projVec ? cosineSim(todoVec, projVec) : 0;
      return { ...p, embedScore };
    }));

    // Combine with graph-Jaccard for tie-breaking
    const todoRefs = collectTodoContextRefs(todoUid);
    const w = state.settings.embeddingGraphWeight;
    return scored
      .map(p => {
        const graphScore = todoRefs.size > 0
          ? jaccard(todoRefs, collectProjectPageRefs(p.name))
          : 0;
        return { ...p, graphScore, combinedScore: (1 - w) * p.embedScore + w * graphScore };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /* ---------- Correction learning (Phase 2) ----------
   * When user changes a BT_attrProject value, capture (AIpick → userPick).
   * Store on [[Auto-Attribute Corrections]] page. Recent corrections become
   * few-shot examples in the LLM prompt. */
  function parseSelectedProjectFromBlockString(blockString) {
    if (!blockString) return null;
    // Match BT_attrProject:: {{or: [[X]] | ...}} OR BT_attrProject:: [[X]]
    const m = blockString.match(/^BT_attrProject::\s*(?:\{\{or:\s*)?\[\[(.+?)\]\]/);
    return m ? m[1] : null;
  }

  function persistTracking() {
    // Strip non-serializable fields (watcherCb is a function)
    const serializable = {};
    for (const [k, v] of Object.entries(state.trackedAttributions)) {
      serializable[k] = {
        todoUid: v.todoUid,
        originalPick: v.originalPick,
        todoText: v.todoText,
        registeredAt: v.registeredAt,
      };
    }
    localStorage.setItem(sk("tracked-attributions"), JSON.stringify(serializable));
  }

  function loadTrackingFromStorage() {
    try {
      return JSON.parse(localStorage.getItem(sk("tracked-attributions")) || "{}");
    } catch { return {}; }
  }

  async function logCorrection(btProjUid, info, newPick) {
    try {
      const corrTitle = state.settings.correctionsPage;
      let pageUid = window.roamAlphaAPI.q(
        `[:find ?u . :where [?p :node/title "${corrTitle}"] [?p :block/uid ?u]]`
      );
      if (!pageUid) {
        pageUid = window.roamAlphaAPI.util.generateUID();
        await window.roamAlphaAPI.data.page.create({
          page: { title: corrTitle, uid: pageUid },
        });
      }
      const ts = new Date().toISOString().slice(11, 19);
      const safeText = (info.todoText || "").replace(/"/g, "'").slice(0, 100);
      const entry = `${formatRoamDate(0)} ${ts} TODO ((${info.todoUid})) | AI: [[${info.originalPick}]] | User: [[${newPick}]] | text: "${safeText}"`;
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": pageUid, order: "last" },
        block: { string: entry },
      });
      log("info", `📝 correction recorded: AI=${info.originalPick} → User=${newPick} (TODO ((${info.todoUid})))`);
    } catch (e) {
      log("warn", "logCorrection failed", e);
    }
  }

  function registerCorrectionWatch(btProjUid, info) {
    try {
      const cb = (before, after) => {
        const newStr = after?.[":block/string"] || "";
        const newPick = parseSelectedProjectFromBlockString(newStr);
        if (!newPick) return;
        if (newPick === info.originalPick) return;
        // Record correction once, then unwatch
        logCorrection(btProjUid, info, newPick).catch(e => log("warn", "logCorrection async err", e));
        try {
          window.roamAlphaAPI.data.removePullWatch("[:block/string]", [":block/uid", btProjUid], cb);
        } catch {}
        delete state.trackedAttributions[btProjUid];
        persistTracking();
      };
      window.roamAlphaAPI.data.addPullWatch("[:block/string]", [":block/uid", btProjUid], cb);
      info.watcherCb = cb;
    } catch (e) {
      log("warn", "registerCorrectionWatch failed", e);
    }
  }

  function trackAttribution(btProjUid, todoUid, originalPick, todoText) {
    const info = {
      todoUid, originalPick, todoText,
      registeredAt: Date.now(),
    };
    state.trackedAttributions[btProjUid] = info;
    persistTracking();
    registerCorrectionWatch(btProjUid, info);
  }

  function rehydrateTracking() {
    const stored = loadTrackingFromStorage();
    let count = 0;
    for (const [uid, info] of Object.entries(stored)) {
      // Skip very old entries (>30 days) — likely stale
      const ageMs = Date.now() - (info.registeredAt || 0);
      if (ageMs > 30 * 24 * 3600 * 1000) continue;
      state.trackedAttributions[uid] = info;
      registerCorrectionWatch(uid, info);
      count++;
    }
    persistTracking();
    if (count > 0) log("info", `rehydrated ${count} correction watchers`);
  }

  function getRecentCorrections(limit) {
    try {
      const corrTitle = state.settings.correctionsPage;
      const pageUid = window.roamAlphaAPI.q(
        `[:find ?u . :where [?p :node/title "${corrTitle}"] [?p :block/uid ?u]]`
      );
      if (!pageUid) return [];
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/string :block/order]}]",
        [":block/uid", pageUid]
      );
      const children = (data?.[":block/children"] || [])
        .sort((a, b) => (a[":block/order"] || 0) - (b[":block/order"] || 0))
        .map(c => c[":block/string"])
        .filter(Boolean);
      return children.slice(-limit);
    } catch (e) {
      return [];
    }
  }

  /* ---------- Project lifecycle (archive / unarchive) ----------
   * Sets Project Status:: <newStatus> on the page. Creates the block if it
   * doesn't exist; updates if it does. Then re-syncs the hub so the
   * dropdown reflects the change immediately. */
  async function setProjectStatus(projectName, newStatus) {
    const safeName = projectName.replaceAll('"', '\\"');
    const pageUid = window.roamAlphaAPI.q(
      `[:find ?u . :where [?p :node/title "${safeName}"] [?p :block/uid ?u]]`
    );
    if (!pageUid) {
      log("error", `page [[${projectName}]] not found`);
      return false;
    }
    try {
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?uid
         :where
         [?p :node/title "${safeName}"]
         [?b :block/page ?p]
         [?b :block/uid ?uid]
         [?b :block/string ?s]
         [(clojure.string/starts-with? ?s "Project Status::")]]
      `);
      const newStr = `Project Status:: ${newStatus}`;
      if (rows.length === 0) {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": pageUid, order: 0 },
          block: { string: newStr },
        });
      } else {
        // Update the first match (assume only one Project Status:: per page)
        await window.roamAlphaAPI.data.block.update({
          block: { uid: rows[0][0], string: newStr },
        });
        // Delete any extra Project Status blocks (legacy mistakes)
        for (let i = 1; i < rows.length; i++) {
          try { await window.roamAlphaAPI.data.block.delete({ block: { uid: rows[i][0] } }); } catch {}
        }
      }
      await syncActiveProjectsHub();
      const emoji = newStatus === "Archive" ? "📦" : (newStatus === "Active" ? "✅" : "🔄");
      log("info", `${emoji} project [[${projectName}]] → ${newStatus}`);
      return true;
    } catch (e) {
      log("error", `setProjectStatus failed for [[${projectName}]]`, e);
      return false;
    }
  }

  function getProjectsByStatus(status) {
    try {
      const prefix = `Project Status:: ${status}`;
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?title
         :where
         [?p :node/title ?title]
         [?b :block/page ?p]
         [?b :block/string ?s]
         [(clojure.string/starts-with? ?s "${prefix}")]]
      `);
      return [...new Set(rows.flat())]
        .filter(t => !isDailyPageTitle(t))
        .filter(t => !isSystemPageTitle(t))
        .sort();
    } catch (e) {
      log("warn", `getProjectsByStatus(${status}) failed`, e);
      return [];
    }
  }

  function getCurrentPageTitle() {
    try {
      const uid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
      if (!uid) return null;
      const data = window.roamAlphaAPI.data.pull("[:node/title]", [":block/uid", uid]);
      return data?.[":node/title"] || null;
    } catch { return null; }
  }

  async function archiveProjectFlow() {
    const currentTitle = getCurrentPageTitle();
    const activeProjects = getActiveProjectsWithAliases().map(p => p.name);
    let name = null;
    if (currentTitle && activeProjects.includes(currentTitle)) {
      // User is viewing an active project page — offer to archive it
      if (confirm(`Archive [[${currentTitle}]]? It will move to Project Status:: Archive and disappear from the dropdown.`)) {
        name = currentTitle;
      } else {
        return;
      }
    } else {
      const list = activeProjects.join("\n  - ");
      name = window.prompt(
        `Enter project name to archive.\n\nActive projects:\n  - ${list}\n\nProject name:`
      );
      if (!name) return;
      name = name.trim();
      if (!activeProjects.includes(name)) {
        if (!confirm(`[[${name}]] isn't in the active list. Archive anyway?`)) return;
      }
    }
    const ok = await setProjectStatus(name, "Archive");
    if (ok) alert(`Archived [[${name}]] — removed from dropdown.`);
  }

  async function unarchiveProjectFlow() {
    const archived = getProjectsByStatus("Archive");
    if (archived.length === 0) {
      alert("No archived projects found.");
      return;
    }
    const list = archived.join("\n  - ");
    const name = window.prompt(
      `Enter project name to UNARCHIVE (back to Active).\n\nArchived projects:\n  - ${list}\n\nProject name:`
    );
    if (!name) return;
    const trimmed = name.trim();
    if (!archived.includes(trimmed)) {
      if (!confirm(`[[${trimmed}]] isn't in the archive list. Unarchive anyway?`)) return;
    }
    const ok = await setProjectStatus(trimmed, "Active");
    if (ok) alert(`Unarchived [[${trimmed}]] — back in the dropdown.`);
  }

  /* ---------- Active Projects hub page sync ----------
   * Maintains [[Active Projects]] — a page whose direct children are
   * [[Project Name]] links, one per page tagged Project Status:: Active.
   * Universal Selector reads the children to populate the BT_attrProject
   * dropdown via `+[[Active Projects]]` source. */
  async function syncActiveProjectsHub() {
    const hubTitle = state.settings.activeProjectsHub;
    let hubUid = window.roamAlphaAPI.q(
      `[:find ?u . :where [?p :node/title "${hubTitle}"] [?p :block/uid ?u]]`
    );
    if (!hubUid) {
      hubUid = window.roamAlphaAPI.util.generateUID();
      try {
        await window.roamAlphaAPI.data.page.create({
          page: { title: hubTitle, uid: hubUid },
        });
        // No description block — Universal Selector includes ALL children as
        // dropdown options. Page name + the project list itself is the doc.
      } catch (e) {
        log("warn", `failed to create hub page [[${hubTitle}]]`, e);
        return null;
      }
    }
    try {
      const projects = getActiveProjectsWithAliases().map(p => `[[${p.name}]]`);
      const projectSet = new Set(projects);
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid :block/string]}]",
        [":block/uid", hubUid]
      );
      const children = (data?.[":block/children"] || []);
      const existingMap = new Map();  // string → uid
      for (const c of children) {
        existingMap.set((c[":block/string"] || "").trim(), c[":block/uid"]);
      }
      let added = 0, removed = 0;
      // Add missing projects
      for (const proj of projects) {
        if (!existingMap.has(proj)) {
          await window.roamAlphaAPI.data.block.create({
            location: { "parent-uid": hubUid, order: "last" },
            block: { string: proj },
          });
          added++;
        }
      }
      // Remove children that aren't active anymore — INCLUDING legacy
      // description blocks from older versions of this script.
      for (const [str, uid] of existingMap) {
        if (!projectSet.has(str)) {
          await window.roamAlphaAPI.data.block.delete({ block: { uid } });
          removed++;
        }
      }
      if (added || removed) {
        log("info", `[[${hubTitle}]] synced — +${added} -${removed}`);
      }
      return hubUid;
    } catch (e) {
      log("warn", `hub sync failed`, e);
      return hubUid;
    }
  }

  /* ---------- Auto-create new project page ----------
   * Called when AI returned project=null but suggested_new_project name.
   * Conservative: respects daily cap + confidence threshold. */
  async function autoCreateProject(name, todoText, attrs) {
    if (!state.settings.autoCreateProjects) return null;
    if ((attrs?.confidence ?? 0) < state.settings.autoCreateMinConfidence) {
      log("info", `auto-create skipped (confidence ${attrs?.confidence?.toFixed(2)} < ${state.settings.autoCreateMinConfidence})`);
      return null;
    }
    if (state.projectsCreatedToday >= state.settings.autoCreateDailyCap) {
      log("warn", `auto-create cap reached (${state.settings.autoCreateDailyCap}/day)`);
      return null;
    }
    if (!name || typeof name !== "string" || name.trim().length < 3) return null;
    const safeName = name.trim();
    // Skip if page already exists
    const existing = window.roamAlphaAPI.q(
      `[:find ?u . :where [?p :node/title "${safeName.replaceAll('"', '\\"')}"] [?p :block/uid ?u]]`
    );
    if (existing) {
      log("info", `auto-create skipped: [[${safeName}]] already exists`);
      return safeName;
    }
    try {
      const newUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.page.create({
        page: { title: safeName, uid: newUid },
      });
      // Add Project Status:: Active and Aliases:: blocks
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": newUid, order: 0 },
        block: { string: `_Auto-created by auto-attribute-todo on ${formatRoamDate(0)} from TODO: "${todoText.slice(0, 80)}"_` },
      });
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": newUid, order: 1 },
        block: { string: "Project Status:: Active" },
      });
      // Suggest aliases from the suggested name (lowercase, individual words)
      const suggestedAliases = safeName.toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3 && !["the", "and", "for", "with"].includes(w))
        .slice(0, 3)
        .join(", ");
      if (suggestedAliases) {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": newUid, order: 2 },
          block: { string: `Aliases:: ${suggestedAliases}` },
        });
      }
      state.projectsCreatedToday++;
      log("warn", `🆕 auto-created project [[${safeName}]] (${state.projectsCreatedToday}/${state.settings.autoCreateDailyCap} today). Verify the page is correct.`);
      // Re-sync hub so the new project appears in dropdowns immediately
      try { await syncActiveProjectsHub(); } catch {}
      return safeName;
    } catch (e) {
      log("error", `auto-create failed for [[${safeName}]]`, e);
      return null;
    }
  }

  // Returns ALL pages with an Aliases:: block, regardless of project status.
  // Used to identify people / entities mentioned in TODO text so the AI can
  // tag them via [[Canonical Name]] page links in BT_attrNotes (creating
  // useful backlinks on the entity's page).
  function getAllEntitiesWithAliases() {
    try {
      const aliasPrefix = state.settings.aliasKeyword + "::";
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?title ?s
         :where
         [?p :node/title ?title]
         [?b :block/page ?p]
         [?b :block/string ?s]
         [(clojure.string/starts-with? ?s "${aliasPrefix}")]]
      `);
      const byPage = {};
      for (const row of rows) {
        const title = row[0];
        const str = (row[1] || "").trim();
        const aliasStr = str.substring(aliasPrefix.length).trim();
        if (!aliasStr) continue;
        const aliases = aliasStr.split(",").map(a => a.trim()).filter(Boolean);
        if (!byPage[title]) byPage[title] = new Set();
        for (const a of aliases) byPage[title].add(a);
      }
      return Object.entries(byPage).map(([name, set]) => ({
        name,
        aliases: [...set],
      }));
    } catch (e) {
      log("warn", "entity alias query failed", e);
      return [];
    }
  }

  function findAllTodos() {
    // Returns recent TODOs first by block edit time. Scan-budget capped at 25.
    try {
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?uid ?edit
         :where
         [?b :block/uid ?uid]
         [?b :block/string ?s]
         [(clojure.string/includes? ?s "{{[[TODO]]}}")]
         [?b :edit/time ?edit]]
      `);
      // Sort newest first, take 25
      rows.sort((a, b) => (b[1] || 0) - (a[1] || 0));
      return rows.slice(0, 25).map((r) => r[0]);
    } catch (e) {
      log("warn", "todo scan query failed", e);
      return [];
    }
  }

  /* ---------- LLM call ---------- */
  async function attribute(uid, text) {
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return null;
    }
    resetCallsIfNewDay();
    if (state.callsToday >= state.settings.dailyCallCap) {
      log("warn", `daily cap ${state.settings.dailyCallCap} reached`);
      return null;
    }

    const projectsDataRaw = getActiveProjectsWithAliases();
    // Phase 3: try semantic embedding ranker first; falls back to Phase 2 if
    // disabled, no key, or network/quota error.
    const embedRanked = await rankProjectsByEmbeddings(uid, text, projectsDataRaw);
    let projectsRanked;
    let rankerUsed;
    if (embedRanked) {
      projectsRanked = embedRanked;
      rankerUsed = "embedding";
    } else {
      // Phase 2 fallback: graph-Jaccard pre-ranking
      projectsRanked = rankProjectsByGraphSignal(uid, projectsDataRaw);
      rankerUsed = "graph-jaccard";
    }
    // Top-K cap keeps prompt small. Phase 3 uses tighter K (5) since cosine
    // is more discriminative than Jaccard.
    const topK = rankerUsed === "embedding"
      ? Math.min(state.settings.embeddingTopK, projectsRanked.length)
      : Math.min(state.settings.graphJaccardTopK, projectsRanked.length);
    const projectsData = projectsRanked.slice(0, topK);
    const projectListLines = projectsData.map(p => {
      const parts = [];
      if (typeof p.embedScore === "number" && p.embedScore > 0) {
        parts.push(`semantic: ${p.embedScore.toFixed(2)}`);
      }
      if (p.graphScore > 0) parts.push(`graph: ${p.graphScore.toFixed(2)}`);
      const scoreNote = parts.length ? ` [${parts.join(", ")}]` : "";
      return p.aliases.length
        ? `- "${p.name}" (aliases: ${p.aliases.join(", ")})${scoreNote}`
        : `- "${p.name}"${scoreNote}`;
    }).join("\n");

    // Phase 2: include recent corrections as few-shot examples
    const recentCorrections = getRecentCorrections(state.settings.fewShotCorrectionsCount);
    const correctionsBlock = recentCorrections.length
      ? `\n\nLEARNED FROM PAST CORRECTIONS (you previously suggested a project, the user manually changed it — learn from these):\n${recentCorrections.join("\n")}\n`
      : "";

    // Entities = pages with Aliases::, EXCLUDING active projects (those are
    // already in the project list above). These are typically people, things,
    // or concepts. The LLM should tag them as [[Canonical Name]] in notes.
    const projectNameSet = new Set(projectsData.map(p => p.name));
    const entitiesData = getAllEntitiesWithAliases()
      .filter(e => !projectNameSet.has(e.name));
    const entityListLines = entitiesData.length
      ? entitiesData.map(e =>
          `- [[${e.name}]] (aliases: ${e.aliases.join(", ")})`
        ).join("\n")
      : "(none)";

    const systemPrompt = `Classify a TODO into Better Tasks attributes. Output ONLY JSON.

You receive the TODO block plus its FULL Roam context: breadcrumb path (parents up to 5 levels deep), sibling blocks in the same list, child blocks (subtasks/notes the user already wrote), and linked pages. Use ALL of this context — not just the TODO text — to classify accurately.

Schema:
{"project": <one exact CANONICAL project name from active list, or null>,
 "priority": "Low"|"Medium"|"High",
 "energy": "Low"|"Medium"|"High",
 "context": "@work"|"@home"|"@computer"|"@errands"|null,
 "top_3_projects": [<top pick (must equal "project")>, <2nd best>, <3rd best>],
 "suggested_new_project": "<IF no existing project fits well, suggest a SHORT (2-5 word) project name that would be appropriate. Examples: 'Personnel Reviews', 'Sanitation Process Audits', 'Q3 Compliance Drive'. Only suggest when project=null AND the TODO seems to belong to a thematic project that doesn't exist yet. Set null otherwise.>",
 "due_offset_days": <int 0-30; 0=today, 1=tomorrow>,
 "notes": "<ONE LINE summary of what this task is for, WHO it's for if mentioned in parent context, and WHY it exists. Pull names of people, meetings, projects from the breadcrumb path or siblings. E.g. 'For Lori per 1:1 meeting on EMP swab review' or 'Follow-up from Mon meeting with Tracy on QC trends'. If no rich context, leave as null and the script will use a default.>",
 "confidence": <0-1>,
 "reasoning": "<one sentence — mention which alias matched, what context informed the project, etc.>"}

Rules from [[Time Block Constraints]] and [[Chief of Staff/Memory]] (already in your context):
- Working hours 08:00-17:00 = ByHeart QA work only (food safety, R, regulatory) → context @work
- Personal/Claude/coding = evenings → context @computer
- Energy High = deep work / writing / debugging
- Energy Low = admin / email / quick task
- Priority High requires explicit urgency markers OR critical-path of an active project
- due_offset_days: 0 if "today/asap/urgent"; 1 default; specific weekday → compute offset; "next week" → 7

Context-aware project matching:
- Match against project names AND their aliases (case-INSENSITIVE).
- Use the breadcrumb path: a TODO nested under "Meeting with Lori" inherits Lori-related project context.
- Use sibling blocks: if siblings reference [[EMP Risk Matrix]] or other project pages, weight those.
- Use child blocks: if user already wrote a sub-note saying "for Lori", pick the Lori-aliased project.
- A person's name matching a project's alias (e.g. "Lori" → "EMP Risk Matrix") is a strong signal.
- Always return the CANONICAL project name from the list below, never the alias.
- If nothing fits, set "project": null AND "top_3_projects": null. ALSO try to suggest a "suggested_new_project" name (2-5 words, thematic) if the TODO clearly belongs to a project category that doesn't exist yet. The script may auto-create that page if auto-create is enabled.

top_3_projects ranking (NEW in v1.2.0 — populates the BT_attrProject dropdown):
- ALWAYS rank top-3 most-relevant active projects when "project" is non-null.
- The first item MUST equal "project" (your top pick goes first).
- 2nd and 3rd are reasonable alternatives the user might prefer.
- If <3 projects are plausibly relevant, return as many as fit (down to 1).
- DON'T pad with random projects — better to return [Top1, Top2] than [Top1, Top2, Junk].
- Names MUST be exact canonical names from the active list (case-sensitive).

Notes field — make it useful, NOT just restating the title:
- Pull WHO the task is for (named in parent/sibling blocks). When you mention
  a person/entity from the "Other entities" list below, ALWAYS write their name
  as a Roam page link [[Canonical Name]] (NOT the alias). This creates a
  backlink on their page — extremely useful. E.g. if TODO mentions "Lori",
  write "[[Lori Boyd]]" in the notes (assuming Lori is an alias for Lori Boyd).
- Pull the TRIGGER (the meeting / discussion / event the parent references)
- Pull RELATED PAGE links if siblings reference them
- Keep it ONE LINE, max ~120 chars
- DO NOT just paraphrase the title — if there's no genuinely new context
  beyond what the title says, set notes null. Notes should ADD information.
- If parent is just a daily-page bullet with no context, set notes null

Cleaned-text field — simplify the TODO title:
- After you've captured info into BT_attr children, the original title often
  contains REDUNDANT hints. Remove them so the title stays focused on the action.
- Date words ("tomorrow", "today", "Friday", "next week", "by EOD"): REMOVE
  them from cleaned_text IF you set due_offset_days. The date is captured.
- Urgency words ("urgent", "ASAP", "important", "must"): REMOVE if you set
  priority High. The priority is captured.
- "for [Person]" phrases: REMOVE if the person is captured in notes via
  [[Canonical Name]]. The notes carry the WHO.
- Project hints: ONLY remove if it's a clear redundant tag (e.g. "EMP" hint
  + project=EMP). Don't remove if the word is integral to the action (e.g.
  don't strip "EMP" if action is "build EMP dashboard").
- Filler words ("need to", "should") can be cleaned if the action verb is clear.
- ALWAYS preserve {{[[TODO]]}} prefix.
- Keep the cleaned title >= 12 chars (or null).
- If unsure whether removing a word loses meaning, set cleaned_text null.

Active projects (pre-ranked by graph-similarity to this TODO's context — projects with graph-similarity > 0 share [[Page]] refs with the TODO and are STRUCTURALLY connected; weight them more strongly):
${projectListLines}

Other entities with aliases (use to TAG in notes via [[Canonical Name]] — these are people, places, things, NOT projects):
${entityListLines}${correctionsBlock}`;

    try {
      state.callsToday++;
      const result = await window.LiveAI_API.generate({
        prompt: `TODO block:\n"${text}"\n\nReturn ONLY the JSON, no markdown fences, no prose.`,
        systemPrompt,
        useDefaultSystemPrompt: false,
        roamContext: {
          block: true,
          blockArgument: [uid],
          path: true,
          pathDepth: state.settings.contextPathDepth,
          children: state.settings.contextChildren,
          siblings: state.settings.contextSiblings,
          pageArgument: state.settings.contextPages,
        },
        responseFormat: "text",
        temperature: 0.3,
        caller: `${NAMESPACE}/${VERSION}`,
      });
      const parsed = parseJsonResponse(result.text);
      if (!parsed) {
        log("error", `unparseable LLM response (${uid})`, result.text?.slice(0, 200));
        return null;
      }
      log("debug", `attrs for ${uid}`, parsed);
      return parsed;
    } catch (e) {
      log("error", `LLM call failed (${uid})`, e);
      return null;
    }
  }

  /* Robust JSON parse — handles raw JSON, json-tag fences, plain fences, and
   * leading/trailing prose. Returns null on failure.
   * NOTE: triple-backticks built from ` escapes to avoid collision with
   * the outer Roam code-block fence that wraps this entire script. */
  function parseJsonResponse(text) {
    if (!text || typeof text !== "string") return null;
    let s = text.trim();
    const FENCE = "`".repeat(3);  // built at runtime so source has no triple-backtick
    // Strip markdown code fence if present
    if (s.startsWith(FENCE)) {
      const re1 = new RegExp("^" + FENCE + "(?:json|JSON)?\\s*\\n?");
      const re2 = new RegExp("\\n?" + FENCE + "\\s*$");
      s = s.replace(re1, "").replace(re2, "");
    }
    // Try direct parse
    try { return JSON.parse(s); } catch {}
    // Extract first {...} block (greedy)
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }

  /* ---------- insertion ---------- */
  // Build BT_attrProject value:
  // - dropdown OFF: flat [[Project]]
  // - dropdown ON, single pick: {{or: [[Top1]] | +attr:[[BT_attrProject]]}}
  // - dropdown ON, multi pick:  {{or: [[T1]] | [[T2]] | [[T3]] | +attr:[[BT_attrProject]]}}
  // The +attr:[[BT_attrProject]] tail makes Universal Selector pull all
  // historical project values for the dropdown — so even a single AI pick
  // gets a usable dropdown.
  function formatProjectValue(attrs) {
    if (!attrs.project) return null;
    if (!state.settings.useDropdown) {
      return `[[${attrs.project}]]`;
    }
    // Always lead with attrs.project (the AI's #1 pick)
    const candidates = [attrs.project];
    if (Array.isArray(attrs.top_3_projects)) {
      for (const p of attrs.top_3_projects) {
        if (typeof p === "string" && p.trim().length > 0 && !candidates.includes(p.trim())) {
          candidates.push(p.trim());
        }
      }
    }
    const capped = candidates.slice(0, 3);
    const options = capped.map(p => `[[${p}]]`).join(" | ");
    // Source pool: [[Active Projects]] hub (current active set).
    // Falls back to attr:[[BT_attrProject]] if hub doesn't exist yet.
    const hubTitle = state.settings.activeProjectsHub;
    return `{{or: ${options} | +[[${hubTitle}]]}}`;
  }

  /* JS-based clean-text — regex fallback when LLM didn't fill cleaned_text.
   * Runs AFTER the LLM has attributed. Strips:
   *  - date words when BT_attrDue is set
   *  - urgency words when priority=High
   *  - "for/with [Alias]" when an aliased person is tagged in notes
   *  - common filler phrases ("need to", "should") */
  function cleanTodoTextJS(originalText, attrs, entitiesData) {
    if (!originalText) return null;
    let cleaned = originalText;

    // Strip date words if due was set
    if (Number.isInteger(attrs?.due_offset_days)) {
      const datePatterns = [
        /\s*\b(today|tomorrow|tonight|yesterday)\b/gi,
        /\s*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
        /\s*\b(mon|tues?|wed|thurs?|fri|sat|sun)\b/gi,
        /\s*\b(this|next|last)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
        /\s*\bby\s+(today|tomorrow|EOD|EOW|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
        /\s*\bin\s+\d+\s+(days?|weeks?|months?)\b/gi,
        /\s*\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      ];
      for (const re of datePatterns) cleaned = cleaned.replace(re, "");
    }

    // Strip urgency words if priority=High
    if (attrs?.priority === "High") {
      cleaned = cleaned.replace(/\s*\b(urgent|asap|important|must|critical|priority|now!?)\b/gi, "");
    }

    // Strip "for/with/to [Alias]" when person tagged in notes via [[Canonical]]
    if (attrs?.notes && Array.isArray(entitiesData)) {
      for (const ent of entitiesData) {
        if (!attrs.notes.includes(`[[${ent.name}]]`)) continue;
        for (const alias of ent.aliases || []) {
          const escAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // "for Lori", "with Lori", "to Lori", "Lori's"
          cleaned = cleaned.replace(new RegExp(`\\s*\\b(for|with|to)\\s+${escAlias}('s)?\\b`, "gi"), "");
          cleaned = cleaned.replace(new RegExp(`\\s*\\b${escAlias}'s\\b`, "gi"), "");
        }
      }
    }

    // Strip common filler
    cleaned = cleaned.replace(/\s*\b(need to|should|have to)\b/gi, "");

    // Collapse whitespace + trim
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    // Sanity guards
    if (!cleaned.includes("{{[[TODO]]}}")) return null;
    if (cleaned.length < state.settings.minTextLength) return null;
    if (cleaned === originalText.trim()) return null;
    return cleaned;
  }

  async function insertAttrs(parentUid, attrs, originalText) {
    const blocks = [];
    const projectValue = formatProjectValue(attrs);
    if (projectValue) blocks.push(`BT_attrProject:: ${projectValue}`);
    if (Number.isInteger(attrs.due_offset_days))
      blocks.push(`BT_attrDue:: ${formatRoamDate(attrs.due_offset_days)}`);
    if (attrs.priority) blocks.push(`BT_attrPriority:: ${attrs.priority}`);
    if (attrs.energy) blocks.push(`BT_attrEnergy:: ${attrs.energy}`);
    if (attrs.context) blocks.push(`BT_attrContext:: ${attrs.context}`);
    const lowConf = typeof attrs.confidence === "number"
      && attrs.confidence < state.settings.confidenceThreshold;
    const userNotes = (attrs.notes && typeof attrs.notes === "string" && attrs.notes.trim().length > 5)
      ? attrs.notes.trim()
      : "auto-attributed";
    const confSuffix = lowConf ? ` (low conf ${attrs.confidence.toFixed(2)} — verify)` : "";
    blocks.push(`BT_attrNotes:: ${userNotes}${confSuffix}`);
    // v1.7.3: dedupe against existing BT_attr children. If the parent
    // already has BT_attrPriority::, don't add another. Last-line defense
    // against duplicate creation in race conditions.
    const existing = window.roamAlphaAPI.data.pull(
      "[{:block/children [:block/string]}]",
      [":block/uid", parentUid]
    );
    const existingKeys = new Set();
    for (const c of (existing?.[":block/children"] || [])) {
      const m = (c[":block/string"] || "").match(/^(BT_attr[A-Za-z]+)::/);
      if (m) existingKeys.add(m[1]);
    }
    const blocksToCreate = blocks.filter(b => {
      const m = b.match(/^(BT_attr[A-Za-z]+)::/);
      if (!m) return true;
      if (existingKeys.has(m[1])) {
        log("debug", `skipping ${m[1]} — already exists on ${parentUid}`);
        return false;
      }
      return true;
    });
    // Track block UIDs we create — specifically the BT_attrProject one
    // gets a correction-learning watcher.
    const createdUids = [];
    for (let i = 0; i < blocksToCreate.length; i++) {
      const newUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": parentUid, order: i },
        block: { uid: newUid, string: blocksToCreate[i] },
      });
      createdUids.push({ uid: newUid, str: blocksToCreate[i] });
    }
    if (blocksToCreate.length < blocks.length) {
      log("info", `[${parentUid}] inserted ${blocksToCreate.length}/${blocks.length} attrs (dedup skipped ${blocks.length - blocksToCreate.length})`);
    }
    // Register correction watcher on the BT_attrProject block (if present)
    if (attrs.project) {
      const btProjEntry = createdUids.find(c => c.str.startsWith("BT_attrProject::"));
      if (btProjEntry) {
        trackAttribution(btProjEntry.uid, parentUid, attrs.project, originalText);
      }
    }

    // Clean the parent TODO text to remove hints now captured in attrs.
    // Two-stage: try LLM-suggested cleaned_text first (richer rewrites),
    // fall back to deterministic JS regex cleaner.
    if (state.settings.cleanTodoText) {
      let cleaned = null;
      // Stage 1: LLM cleaned_text
      if (attrs.cleaned_text && typeof attrs.cleaned_text === "string") {
        const llmCleaned = attrs.cleaned_text.trim();
        if (
          llmCleaned.includes("{{[[TODO]]}}") &&
          llmCleaned.length >= state.settings.minTextLength &&
          llmCleaned.length < (originalText || "").length &&
          llmCleaned !== originalText.trim()
        ) {
          cleaned = llmCleaned;
        }
      }
      // Stage 2: JS regex fallback
      if (!cleaned) {
        const entitiesData = getAllEntitiesWithAliases();
        cleaned = cleanTodoTextJS(originalText, attrs, entitiesData);
      }
      if (cleaned) {
        try {
          await window.roamAlphaAPI.data.block.update({
            block: { uid: parentUid, string: cleaned },
          });
          log("info", `cleaned title [${parentUid}]: ${originalText.length - cleaned.length} chars dropped`);
        } catch (e) {
          log("warn", `cleaned-text update failed [${parentUid}]`, e);
        }
      }
    }
  }

  /* ---------- Roam log ---------- */
  async function logToRoam(uid, attrs, error) {
    try {
      let pageUid = window.roamAlphaAPI.q(
        `[:find ?u . :where [?p :node/title "${LOG_PAGE}"] [?p :block/uid ?u]]`
      );
      if (!pageUid) {
        pageUid = window.roamAlphaAPI.util.generateUID();
        await window.roamAlphaAPI.data.page.create({
          page: { title: LOG_PAGE, uid: pageUid },
        });
      }
      const ts = new Date().toISOString().slice(11, 19);
      // ((uid)) block-ref so log entries are CLICKABLE — jump back to the
      // source TODO with one click. Each TODO accrues one backlink per day
      // (bounded by processedToday cache + once-per-day attempt). Project
      // name as [[link]] so the log shows up on the project page too.
      const projectStr = attrs?.project ? `[[${attrs.project}]]` : "no-project";
      const summary = error
        ? `${ts} FAIL ((${uid})): ${error}`
        : `${ts} OK ((${uid})) → ${projectStr} / ${attrs.priority || "?"} / conf ${(attrs.confidence ?? 0).toFixed(2)}`;
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": pageUid, order: "last" },
        block: { string: `${formatRoamDate(0)} ${summary}` },
      });
    } catch (e) {
      log("warn", "log-to-roam failed", e);
    }
  }

  /* ---------- core processor ---------- */
  async function processBlock(uid) {
    state.pending.delete(uid);
    if (state.processedToday.has(uid)) return;

    const data = getBlock(uid);
    if (!data) return;
    const text = data[":block/string"] || "";
    if (!isTodo(text)) return;
    if (text.length < state.settings.minTextLength) return;
    if (hasBTProject(data)) {
      state.processedToday.add(uid);
      persistProcessed();
      return;
    }

    log("info", `processing [${uid}] "${text.slice(0, 60)}"`);
    // Mark as attempted-today UP FRONT so any failure path doesn't loop on the
    // 5-min safety scan. User can manually retry via "process focused TODO now"
    // (which removes the uid from processedToday before re-processing).
    state.processedToday.add(uid);
    persistProcessed();

    const attrs = await attribute(uid, text);
    if (!attrs) {
      await logToRoam(uid, null, "no result");
      return;
    }
    // Auto-create project if AI returned null project but suggested a new one
    if (!attrs.project && attrs.suggested_new_project) {
      const created = await autoCreateProject(attrs.suggested_new_project, text, attrs);
      if (created) {
        attrs.project = created;
        attrs.top_3_projects = [created];
      }
    }
    if (state.settings.requireConfirmation) {
      log("info", "(suggestion-only mode) attrs:", attrs);
      await logToRoam(uid, attrs, "suggestion-only");
      return;
    }
    // v1.7.3: race-window guard. The LLM call took ~5s. In that window
    // another runner (parallel scan, ghost cmd from re-paste, pull-watch fire)
    // may have already attributed this TODO. Re-fetch and skip if so.
    const dataAfter = getBlock(uid);
    if (dataAfter && hasBTProject(dataAfter)) {
      log("info", `[${uid}] already has BT_attrProject after LLM call — skipping insert (race avoided)`);
      await logToRoam(uid, attrs, "race-skipped");
      return;
    }
    try {
      await insertAttrs(uid, attrs, text);
      await logToRoam(uid, attrs, null);
    } catch (e) {
      log("error", `insert failed (${uid})`, e);
      await logToRoam(uid, attrs, e.message);
    }
  }

  function schedule(uid) {
    if (state.pending.has(uid)) clearTimeout(state.pending.get(uid));
    const timer = setTimeout(() => processBlock(uid), state.settings.debounceMs);
    state.pending.set(uid, timer);
  }

  /* ---------- watchers ---------- */
  function startScan() {
    state.scanTimer = setInterval(() => {
      if (!state.settings.enabled) return;
      if (state.settings.syncHubOnScan) {
        syncActiveProjectsHub().catch(e => log("warn", "hub sync failed", e));
      }
      // v1.7.4: pick up any setting the user changed inline on the settings page
      loadAllSettingsFromGraph();
      // Phase 3: refresh stale embeddings + GC removed projects every cycle
      refreshEmbeddingsIfStale().catch(e => log("warn", "embed refresh failed", e?.message || e));
      const uids = findAllTodos();
      let queued = 0;
      const budget = state.settings.scanBudgetPerCycle;
      for (const uid of uids) {
        if (queued >= budget) break;
        if (state.processedToday.has(uid)) continue;
        if (state.pending.has(uid)) continue;
        const data = getBlock(uid);
        if (!data) continue;
        if (hasBTProject(data)) {
          state.processedToday.add(uid);
          continue;
        }
        if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
        schedule(uid);
        queued++;
      }
      if (queued > 0) log("info", `scan queued ${queued}/${budget}`);
    }, state.settings.scanIntervalMs);
  }

  function startPullWatch() {
    try {
      const todoPageUid = window.roamAlphaAPI.q(
        `[:find ?u . :where [?p :node/title "TODO"] [?p :block/uid ?u]]`
      );
      if (!todoPageUid) {
        log("warn", "[[TODO]] page not found — pullwatch disabled, scan-only mode");
        return;
      }
      const cb = (before, after) => {
        if (!state.settings.enabled) return;
        const beforeUids = new Set(((before?.[":block/_refs"]) || []).map(r => r[":db/id"]));
        const afterRefs = (after?.[":block/_refs"]) || [];
        for (const ref of afterRefs) {
          if (beforeUids.has(ref[":db/id"])) continue;
          // resolve to uid
          const refData = window.roamAlphaAPI.data.pull("[:block/uid]", ref[":db/id"]);
          const uid = refData?.[":block/uid"];
          if (uid) schedule(uid);
        }
      };
      window.roamAlphaAPI.data.addPullWatch(
        "[:block/_refs]",
        [":block/uid", todoPageUid],
        cb
      );
      state.pullWatchUnsub = () => window.roamAlphaAPI.data.removePullWatch(
        "[:block/_refs]", [":block/uid", todoPageUid], cb
      );
      log("info", "pullwatch on [[TODO]] page registered");
    } catch (e) {
      log("warn", "pullwatch register failed (will rely on scan)", e);
    }
  }

  /* ---------- command palette ---------- */
  function registerCommands() {
    // Idempotent: removeCommand first so re-pasting the script REPLACES old
    // commands (which closure over stale state) instead of doubling them up.
    // Track labels we register so cleanup() can also remove them later.
    state.registeredCommandLabels = state.registeredCommandLabels || new Set();
    const add = (label, callback) => {
      try { window.roamAlphaAPI.ui.commandPalette.removeCommand({ label }); } catch {}
      try {
        window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback });
        state.registeredCommandLabels.add(label);
      } catch (e) { log("warn", `add cmd failed: ${label}`, e); }
    };
    add("Auto-Attribute: process focused TODO now", async () => {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (!f) return log("info", "no focused block");
      state.processedToday.delete(f["block-uid"]); // allow re-process
      await processBlock(f["block-uid"]);
    });
    // v1.7.4: each toggle persists to BOTH localStorage AND the graph
    // settings page, so [[Auto-Attribute Settings]] always shows current
    // state. Toggle from cmd palette OR edit the page block — same result.
    const toggleSetting = (graphKey, settingsKey, descriptor) => async () => {
      state.settings[settingsKey] = !state.settings[settingsKey];
      persistSettings();
      await persistSettingToGraph(graphKey);
      const status = state.settings[settingsKey] ? "ON" : "OFF";
      log("info", `${descriptor}: ${status}`);
    };
    add("Auto-Attribute: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("Auto-Attribute: toggle suggestion-only mode", toggleSetting("require_confirmation", "requireConfirmation", "requireConfirmation"));
    add("Auto-Attribute: toggle clean-text (rewrite TODO title)", toggleSetting("clean_todo_text", "cleanTodoText", "cleanTodoText"));
    add("Auto-Attribute: toggle dropdown mode (BT_attrProject)", toggleSetting("use_dropdown", "useDropdown", "useDropdown"));
    add("Auto-Attribute: toggle auto-create projects", async () => {
      await toggleSetting("auto_create_projects", "autoCreateProjects", "autoCreateProjects")();
      if (state.settings.autoCreateProjects) {
        log("info", `(min conf ${state.settings.autoCreateMinConfidence}, cap ${state.settings.autoCreateDailyCap}/day)`);
      }
    });
    add("Auto-Attribute: sync [[Active Projects]] hub now", async () => {
      const uid = await syncActiveProjectsHub();
      log("info", `hub sync done — uid=${uid}`);
    });
    add("Auto-Attribute: open settings page (edit toggles inline)", async () => {
      try {
        const pageUid = await ensureSettingsPage(true);
        log("info", `Settings page opened — edit any setting block in the right sidebar. Page uid: ${pageUid}`);
      } catch (e) {
        log("error", "ensureSettingsPage failed", e);
      }
    });
    add("Auto-Attribute: show recent corrections (debug)", () => {
      const recent = getRecentCorrections(state.settings.fewShotCorrectionsCount);
      if (!recent.length) {
        log("info", "no corrections yet — change a BT_attrProject value and the script will learn");
        return;
      }
      log("info", `last ${recent.length} corrections (used as few-shot in LLM prompt):`);
      for (const c of recent) console.log("  " + c);
    });
    add("Auto-Attribute: archive a project (move to Archive status)", archiveProjectFlow);
    add("Auto-Attribute: unarchive a project (back to Active)", unarchiveProjectFlow);
    add("Auto-Attribute: list projects by status (debug)", () => {
      const statuses = ["Active", "Ongoing", "On Hold", "Paused", "Archive", "Done", "Completed"];
      const out = {};
      for (const s of statuses) out[s] = getProjectsByStatus(s);
      console.log("[auto-attr-todo] projects by status:");
      for (const [s, list] of Object.entries(out)) {
        if (list.length > 0) {
          console.log(`  ${s} (${list.length}):`);
          list.forEach(p => console.log(`    - ${p}`));
        }
      }
    });
    add("Auto-Attribute: show graph-similarity for focused TODO (debug)", () => {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (!f) return log("info", "no focused block");
      const projects = getActiveProjectsWithAliases();
      const ranked = rankProjectsByGraphSignal(f["block-uid"], projects);
      console.table(ranked.map(p => ({
        project: p.name,
        graph_score: p.graphScore.toFixed(3),
        aliases: p.aliases.join(", ") || "(none)",
      })));
    });
    add("Auto-Attribute: convert existing flat BT_attrProject to dropdown (bulk)", async () => {
      if (!confirm("Convert ALL existing BT_attrProject:: [[X]] blocks to {{or:}} dropdown format?\n\nThis lets you pick from your project history via Universal Selector. Reversible by manual edit. Continue?")) return;
      try {
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?uid ?s
           :where
           [?b :block/uid ?uid]
           [?b :block/string ?s]
           [(clojure.string/starts-with? ?s "BT_attrProject:: [[")]]
        `);
        let converted = 0, skipped = 0;
        for (const row of rows) {
          const uid = row[0];
          const s = row[1];
          // skip if already a dropdown
          if (s.includes("{{or:")) { skipped++; continue; }
          // extract [[Project]] from string after "BT_attrProject:: "
          const m = s.match(/^BT_attrProject::\s*\[\[(.+?)\]\]\s*$/);
          if (!m) { skipped++; continue; }
          const project = m[1];
          const newStr = `BT_attrProject:: {{or: [[${project}]] | +attr:[[BT_attrProject]]}}`;
          await window.roamAlphaAPI.data.block.update({
            block: { uid, string: newStr },
          });
          converted++;
        }
        log("info", `bulk convert complete — ${converted} converted, ${skipped} skipped`);
        alert(`Converted ${converted} BT_attrProject blocks to dropdown format.\n${skipped} skipped (already dropdown or unparseable).`);
      } catch (e) {
        log("error", "bulk convert failed", e);
        alert("Bulk convert failed: " + e.message);
      }
    });
    add("Auto-Attribute: set Gemini API key (Phase 3 embeddings)", async () => {
      // Opens [[Auto-Attribute Settings]] page in the right sidebar with
      // a gemini_api_key:: PASTE_YOUR_KEY_HERE block (and all other
      // toggles). User edits the value inline; script picks it up.
      try {
        await ensureSettingsPage(true);
        log("info", `Settings page opened — edit gemini_api_key:: block in the right sidebar`);
      } catch (e) {
        log("error", "ensureSettingsPage failed", e);
      }
    });
    add("Auto-Attribute: reload settings from graph (after editing settings page)", () => {
      const updated = loadAllSettingsFromGraph();
      if (updated > 0) {
        log("info", `${updated} setting(s) reloaded from graph`);
      } else {
        log("info", "no setting changes detected. Edit a `key:: value` block on [[Auto-Attribute Settings]] then re-run.");
      }
    });
    add("Auto-Attribute: toggle embeddings (Phase 3)", async () => {
      if (!state.settings.geminiApiKey && !state.settings.useEmbeddings) {
        alert("Set Gemini API key first via 'Auto-Attribute: set Gemini API key'.");
        return;
      }
      state.settings.useEmbeddings = !state.settings.useEmbeddings;
      persistSettings();
      await persistSettingToGraph("use_embeddings");
      log("info", `useEmbeddings: ${state.settings.useEmbeddings ? "ON" : "OFF"}`);
      if (state.settings.useEmbeddings) {
        state.embedsBootstrapped = false;
        bootstrapEmbeddings().catch(e => log("warn", "post-toggle bootstrap failed", e?.message || e));
      }
    });
    add("Auto-Attribute: rebuild all embeddings (force refresh)", async () => {
      if (!state.settings.geminiApiKey) {
        alert("Set Gemini API key first.");
        return;
      }
      const projects = getActiveProjectsWithAliases();
      if (!confirm(`Rebuild embeddings for ${projects.length} active projects?\nThis will hit the Gemini API ${projects.length} times (~${Math.ceil(projects.length * 100 / 1000)}s, free tier).`)) return;
      let ok = 0, fail = 0;
      state.projectEmbeddings.clear();
      for (const p of projects) {
        try {
          const text = buildProjectEmbedText(p.name, p.aliases);
          const hash = await sha256Short(text);
          const vector = await callGeminiEmbed(text);
          await idbPutEmbed({ name: p.name, hash, vector, ts: Date.now(), aliases: p.aliases });
          state.projectEmbeddings.set(p.name, vector);
          ok++;
        } catch (e) {
          log("warn", `rebuild failed for ${p.name}`, e?.message || e);
          fail++;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      log("info", `rebuild done: ${ok} ok, ${fail} failed`);
      alert(`Rebuilt ${ok} embeddings (${fail} failed). See console for details.`);
    });
    add("Auto-Attribute: show embedding-similarity for focused TODO (debug)", async () => {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (!f) return log("info", "no focused block");
      if (!state.settings.useEmbeddings || !state.settings.geminiApiKey) {
        return log("info", "embeddings disabled or no key — enable first");
      }
      const data = getBlock(f["block-uid"]);
      const text = data?.[":block/string"] || "";
      const projects = getActiveProjectsWithAliases();
      const ranked = await rankProjectsByEmbeddings(f["block-uid"], text, projects);
      if (!ranked) return log("warn", "embedding ranker returned null — check console for error");
      console.table(ranked.map(p => ({
        project: p.name,
        semantic: typeof p.embedScore === "number" ? p.embedScore.toFixed(3) : "n/a",
        graph: p.graphScore?.toFixed(3) || "0.000",
        combined: p.combinedScore?.toFixed(3) || "n/a",
      })));
    });
    add("Auto-Attribute: show embeddings cache (debug)", async () => {
      try {
        const all = await idbGetAllEmbeds();
        console.log(`[auto-attr-todo] ${all.length} cached embeddings:`);
        console.table(all.map(rec => ({
          project: rec.name,
          dim: rec.vector?.length || 0,
          hash: rec.hash,
          aliases: (rec.aliases || []).join(", "),
          age_min: ((Date.now() - rec.ts) / 60000).toFixed(0),
        })));
      } catch (e) {
        log("error", "show cache failed", e);
      }
    });
    add("Auto-Attribute: dedupe BT_attr children (cleanup duplicates)", async () => {
      // Scan all TODOs; for each, if it has multiple BT_attrX:: children with
      // the same key, delete all but the first. Reports counts.
      try {
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?uid
           :where
           [?b :block/uid ?uid]
           [?b :block/string ?s]
           [(clojure.string/includes? ?s "{{[[TODO]]}}")]]
        `);
        const todoUids = rows.flat();
        if (!confirm(`Scan ${todoUids.length} TODOs for duplicate BT_attr children and delete the duplicates?\n\nKeeps the FIRST occurrence of each BT_attrX:: key, deletes the rest. Reversible by undo (Cmd+Z).`)) return;
        let scanned = 0, todosFixed = 0, blocksDeleted = 0;
        for (const uid of todoUids) {
          scanned++;
          const data = window.roamAlphaAPI.data.pull(
            "[{:block/children [:block/uid :block/string :block/order]}]",
            [":block/uid", uid]
          );
          const children = (data?.[":block/children"] || [])
            .slice()
            .sort((a, b) => (a[":block/order"] || 0) - (b[":block/order"] || 0));
          const seenKeys = new Set();
          const toDelete = [];
          for (const c of children) {
            const m = (c[":block/string"] || "").match(/^(BT_attr[A-Za-z]+)::/);
            if (!m) continue;
            const key = m[1];
            if (seenKeys.has(key)) {
              toDelete.push(c[":block/uid"]);
            } else {
              seenKeys.add(key);
            }
          }
          if (toDelete.length === 0) continue;
          for (const dUid of toDelete) {
            try {
              await window.roamAlphaAPI.data.block.delete({ block: { uid: dUid } });
              blocksDeleted++;
            } catch (e) {
              log("warn", `delete dupe ${dUid} failed`, e?.message || e);
            }
          }
          todosFixed++;
        }
        const msg = `Scanned ${scanned} TODOs, fixed ${todosFixed}, deleted ${blocksDeleted} duplicate BT_attr blocks.`;
        log("info", msg);
        alert(msg);
      } catch (e) {
        log("error", "dedupe failed", e);
        alert("Dedupe failed: " + e.message);
      }
    });
    add("Auto-Attribute: discover available embedding models (debug)", async () => {
      try {
        const models = await discoverEmbeddingModels();
        if (!models.length) {
          alert("Google's API returned NO embedding-capable models for your key. Either the key is invalid or the embedContent endpoint is unavailable.");
          return;
        }
        console.log("[auto-attr-todo] embedding-capable models:");
        for (const m of models) console.log("  -", m);
        alert(`Found ${models.length} embedding model(s):\n\n${models.join("\n")}\n\nFallback chain has been refreshed. Run \"rebuild all embeddings\" to retry with the discovered list.`);
        state.settings.embeddingModelFallbacks = models;
        if (models.length > 0) state.settings.embeddingModel = models[0];
      } catch (e) {
        log("error", "discover failed", e);
        alert("Discover failed: " + e.message);
      }
    });
    add("Auto-Attribute: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `auto-attribute-todo v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.autoCreateProjects)} auto-create projects`,
        `  ${onOff(state.settings.cleanTodoText)} clean TODO text (rewrite title)`,
        `  ${onOff(state.settings.useDropdown)} dropdown for BT_attrProject`,
        `  ${onOff(state.settings.useEmbeddings)} embeddings (Phase 3 semantic ranker)`,
        `  ${onOff(state.settings.requireConfirmation)} suggestion-only mode`,
        `  ${onOff(state.settings.syncHubOnScan)} sync [[Active Projects]] hub on scan`,
        ``,
        `── runtime ──`,
        `  LLM calls today: ${state.callsToday} / ${state.settings.dailyCallCap}`,
        `  Processed today: ${state.processedToday.size}`,
        `  Pending debounce: ${state.pending.size}`,
        `  LiveAI available: ${!!window.LiveAI_API?.isAvailable()}`,
        `  Gemini key set: ${!!state.settings.geminiApiKey}${state.settings.geminiApiKey ? ` (${state.settings.geminiApiKey.slice(0,6)}...${state.settings.geminiApiKey.slice(-4)})` : ""}`,
        `  Embedding model: ${state.settings.embeddingModel}`,
        `  Cached embeddings: ${state.projectEmbeddings.size}`,
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${state.settings.settingsPage}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });
    add("Auto-Attribute: scan now", () => {
      const uids = findAllTodos();
      let queued = 0;
      const budget = state.settings.scanBudgetPerCycle;
      for (const uid of uids) {
        if (queued >= budget) break;
        if (state.processedToday.has(uid) || state.pending.has(uid)) continue;
        const data = getBlock(uid);
        if (!data || hasBTProject(data)) continue;
        if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
        schedule(uid); queued++;
      }
      log("info", `manual scan queued ${queued}/${budget} blocks`);
    });
    add("Auto-Attribute: emergency stop (cleanup + disable)", () => {
      state.settings.enabled = false;
      try { cleanup(); } catch (e) { log("warn", "cleanup err", e); }
      log("info", "EMERGENCY STOP — disabled, scan + pullwatch killed for this tab. Refresh page to restart.");
    });
    add("Auto-Attribute: clear processedToday cache (allow re-process)", () => {
      state.processedToday = new Set();
      persistProcessed();
      log("info", "processedToday cleared — next scan will re-evaluate everything (within budget)");
    });
    add("Auto-Attribute: show active projects + aliases (debug)", () => {
      const data = getActiveProjectsWithAliases();
      console.table(data.map(p => ({
        project: p.name,
        aliases: p.aliases.join(", ") || "(none)",
      })));
    });
    add("Auto-Attribute: show ALL aliased entities (debug)", () => {
      const data = getAllEntitiesWithAliases();
      console.table(data.map(e => ({
        page: e.name,
        aliases: e.aliases.join(", "),
      })));
    });
  }

  /* ---------- init ---------- */
  function init() {
    log("info", `v${VERSION} starting`);
    // v1.7.3: kill any prior version of this script that's still running in
    // this tab (re-paste of roam/js block leaves old timers, watchers, and
    // cmd palette commands alive — they closure over old state and double
    // every action). Detect via window namespace marker.
    const priorCleanup = window[`${NAMESPACE}_cleanup`];
    if (typeof priorCleanup === "function") {
      try {
        priorCleanup();
        log("info", "cleaned up prior version's timers/watchers/commands");
      } catch (e) {
        log("warn", "prior cleanup threw, continuing anyway", e?.message || e);
      }
    }
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, calls will fail until LiveAI loads with the public API enabled. Toggle on in LiveAI settings.");
    } else {
      log("info", `LiveAI default model: ${window.LiveAI_API.getDefaultModel()}`);
    }
    state.processedToday = loadProcessed();
    loadPersistentSettings();  // Phase 3: rehydrate from localStorage cache
    // v1.7.4: bootstrap [[Auto-Attribute Settings]] page (creates missing
    // setting blocks idempotently) then load values from graph. Graph wins
    // over localStorage if they disagree — page is source of truth.
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      .catch(e => log("warn", "settings page bootstrap failed", e?.message || e));
    registerCommands();
    startPullWatch();
    startScan();
    // Initial hub sync (best-effort, non-blocking)
    syncActiveProjectsHub().catch(e => log("warn", "initial hub sync failed", e));
    // Phase 2: rehydrate correction watchers from previous sessions
    rehydrateTracking();
    // Phase 3: bootstrap embeddings if enabled (background, non-blocking)
    if (state.settings.useEmbeddings && state.settings.geminiApiKey) {
      bootstrapEmbeddings().catch(e => log("warn", "embed bootstrap failed", e?.message || e));
    } else if (state.settings.useEmbeddings && !state.settings.geminiApiKey) {
      log("warn", "embeddings enabled but no Gemini API key — falling back to graph-Jaccard. Set key via cmd palette.");
    }
    window[`${NAMESPACE}_state`] = state;
    log("info", `ready. ${state.processedToday.size} already processed today. embeddings: ${state.settings.useEmbeddings && state.settings.geminiApiKey ? "ON" : "OFF"}`);
  }

  function cleanup() {
    if (state.scanTimer) clearInterval(state.scanTimer);
    if (state.pullWatchUnsub) try { state.pullWatchUnsub(); } catch {}
    for (const t of state.pending.values()) clearTimeout(t);
    state.pending.clear();
    // Unwatch correction watchers
    for (const [uid, info] of Object.entries(state.trackedAttributions)) {
      if (info.watcherCb) {
        try { window.roamAlphaAPI.data.removePullWatch("[:block/string]", [":block/uid", uid], info.watcherCb); } catch {}
      }
    }
    // v1.7.3: also unregister cmd palette commands so they don't pile up
    // when the script is re-pasted multiple times.
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
