/* auto-attribute-todo v1.1.0
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
  const VERSION = "1.1.0";
  const NAMESPACE = "auto-attr-todo";
  const LOG_PAGE = "Auto-Attribute TODO Log";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 30000,           // 30 sec — give user time to think before AI fires
    minTextLength: 12,
    confidenceThreshold: 0.6,
    dailyCallCap: 100,
    scanIntervalMs: 15 * 60_000,
    scanBudgetPerCycle: 10,
    contextPages: ["Time Block Constraints", "Chief of Staff/Memory"],
    requireConfirmation: false,
    aliasKeyword: "Aliases",     // configurable per dive2Pro/roam-aliases convention
    contextPathDepth: 5,         // how many ancestors to include in roamContext
    contextChildren: true,       // include block's children (subtasks, notes)
    contextSiblings: true,       // include sibling blocks (other items in same list)
  };

  const state = {
    settings: { ...DEFAULTS },
    pending: new Map(),          // uid → debounce timer
    processedToday: new Set(),
    callsToday: 0,
    callsResetDate: new Date().toDateString(),
    pullWatchUnsub: null,
    scanTimer: null,
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

  function resetCallsIfNewDay() {
    const today = new Date().toDateString();
    if (state.callsResetDate !== today) {
      state.callsToday = 0;
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

  function getActiveProjectsWithAliases() {
    // Returns [{name, aliases: []}, ...] for each page tagged Project Status:: Active.
    // Aliases are read from blocks starting with "Aliases::" on each project page
    // (dive2Pro/roam-aliases convention — first-level block of a page).
    try {
      const projectRows = window.roamAlphaAPI.data.q(`
        [:find ?title
         :where
         [?p :node/title ?title]
         [?b :block/page ?p]
         [?b :block/string ?s]
         [(clojure.string/includes? ?s "Project Status:: Active")]]
      `);
      const projects = [...new Set(projectRows.flat())].slice(0, 60);
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

    const projectsData = getActiveProjectsWithAliases();
    const projectListLines = projectsData.map(p =>
      p.aliases.length
        ? `- "${p.name}" (aliases: ${p.aliases.join(", ")})`
        : `- "${p.name}"`
    ).join("\n");

    const systemPrompt = `Classify a TODO into Better Tasks attributes. Output ONLY JSON.

You receive the TODO block plus its FULL Roam context: breadcrumb path (parents up to 5 levels deep), sibling blocks in the same list, child blocks (subtasks/notes the user already wrote), and linked pages. Use ALL of this context — not just the TODO text — to classify accurately.

Schema:
{"project": <one exact CANONICAL project name from active list, or null>,
 "priority": "Low"|"Medium"|"High",
 "energy": "Low"|"Medium"|"High",
 "context": "@work"|"@home"|"@computer"|"@errands"|null,
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
- If nothing fits, set "project": null.

Notes field — make it useful, not just restating the title:
- Pull WHO the task is for (named in parent/sibling blocks)
- Pull the TRIGGER (the meeting / discussion / event the parent references)
- Pull the RELATED PAGE links if siblings reference [[Page]]s
- Keep it ONE LINE, max ~120 chars
- If the parent is just a daily page bullet with no context, leave notes null

Active projects with aliases:
${projectListLines}`;

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
  async function insertAttrs(parentUid, attrs) {
    const blocks = [];
    if (attrs.project) blocks.push(`BT_attrProject:: [[${attrs.project}]]`);
    if (Number.isInteger(attrs.due_offset_days))
      blocks.push(`BT_attrDue:: ${formatRoamDate(attrs.due_offset_days)}`);
    if (attrs.priority) blocks.push(`BT_attrPriority:: ${attrs.priority}`);
    if (attrs.energy) blocks.push(`BT_attrEnergy:: ${attrs.energy}`);
    if (attrs.context) blocks.push(`BT_attrContext:: ${attrs.context}`);
    const lowConf = typeof attrs.confidence === "number"
      && attrs.confidence < state.settings.confidenceThreshold;
    // Use the LLM-generated notes if it gave us something substantive, otherwise default.
    const userNotes = (attrs.notes && typeof attrs.notes === "string" && attrs.notes.trim().length > 5)
      ? attrs.notes.trim()
      : "auto-attributed";
    const confSuffix = lowConf ? ` (low conf ${attrs.confidence.toFixed(2)} — verify)` : "";
    blocks.push(`BT_attrNotes:: ${userNotes}${confSuffix}`);
    for (let i = 0; i < blocks.length; i++) {
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": parentUid, order: i },
        block: { string: blocks[i] },
      });
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
      // Plain `[uid]` text — NOT ((uid)) — to avoid polluting the source
      // TODO's backlink count with log entries.
      const summary = error
        ? `${ts} FAIL [${uid}]: ${error}`
        : `${ts} OK [${uid}] → ${attrs.project || "no-project"} / ${attrs.priority || "?"} / conf ${(attrs.confidence ?? 0).toFixed(2)}`;
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
    if (state.settings.requireConfirmation) {
      log("info", "(suggestion-only mode) attrs:", attrs);
      await logToRoam(uid, attrs, "suggestion-only");
      return;
    }
    try {
      await insertAttrs(uid, attrs);
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
    const add = (label, callback) => {
      try { window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback }); }
      catch (e) { log("warn", `add cmd failed: ${label}`, e); }
    };
    add("Auto-Attribute: process focused TODO now", async () => {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (!f) return log("info", "no focused block");
      state.processedToday.delete(f["block-uid"]); // allow re-process
      await processBlock(f["block-uid"]);
    });
    add("Auto-Attribute: toggle enabled", () => {
      state.settings.enabled = !state.settings.enabled;
      log("info", `enabled: ${state.settings.enabled}`);
    });
    add("Auto-Attribute: toggle suggestion-only mode", () => {
      state.settings.requireConfirmation = !state.settings.requireConfirmation;
      log("info", `requireConfirmation: ${state.settings.requireConfirmation}`);
    });
    add("Auto-Attribute: show stats", () => {
      log("info", "stats", {
        version: VERSION,
        enabled: state.settings.enabled,
        callsToday: state.callsToday,
        dailyCap: state.settings.dailyCallCap,
        processedToday: state.processedToday.size,
        pending: state.pending.size,
        liveaiAvailable: !!window.LiveAI_API?.isAvailable(),
      });
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
  }

  /* ---------- init ---------- */
  function init() {
    log("info", `v${VERSION} starting`);
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, calls will fail until LiveAI loads with the public API enabled. Toggle on in LiveAI settings.");
    } else {
      log("info", `LiveAI default model: ${window.LiveAI_API.getDefaultModel()}`);
    }
    state.processedToday = loadProcessed();
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
    log("info", "cleaned up");
  }
  window[`${NAMESPACE}_cleanup`] = cleanup;

  init();
})();
