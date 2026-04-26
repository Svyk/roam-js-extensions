/* auto-attribute-todo v1.2.0
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
  const VERSION = "1.2.0";
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
    cleanTodoText: true,         // rewrite TODO title to remove hints captured in attrs
    useDropdown: true,           // emit BT_attrProject as {{or:}} dropdown of top-3 candidates
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

    const projectsData = getActiveProjectsWithAliases();
    const projectListLines = projectsData.map(p =>
      p.aliases.length
        ? `- "${p.name}" (aliases: ${p.aliases.join(", ")})`
        : `- "${p.name}"`
    ).join("\n");

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
- If nothing fits, set "project": null AND "top_3_projects": null.

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

Active projects with aliases (use for "project" field):
${projectListLines}

Other entities with aliases (use to TAG in notes via [[Canonical Name]] — these are people, places, things, NOT projects):
${entityListLines}`;

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
  // Build BT_attrProject value — flat [[Project]] for single pick or
  // {{or: [[A]] | [[B]] | [[C]]}} dropdown for ranked candidates.
  function formatProjectValue(attrs) {
    if (!attrs.project) return null;
    const top3 = Array.isArray(attrs.top_3_projects)
      ? attrs.top_3_projects.filter(p => typeof p === "string" && p.trim().length > 0)
      : [];
    // If dropdown disabled, or top_3 not provided / single candidate, use flat.
    if (!state.settings.useDropdown || top3.length < 2) {
      return `[[${attrs.project}]]`;
    }
    // Dedupe + cap at 3
    const seen = new Set();
    const unique = top3.filter(p => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    }).slice(0, 3);
    if (unique.length < 2) return `[[${attrs.project}]]`;
    const options = unique.map(p => `[[${p}]]`).join(" | ");
    return `{{or: ${options}}}`;
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
    for (let i = 0; i < blocks.length; i++) {
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": parentUid, order: i },
        block: { string: blocks[i] },
      });
    }

    // OPTIONAL: clean the parent TODO text to remove hints now captured in attrs.
    // Conservative guards: must start with {{[[TODO]]}}, must be shorter than
    // original, must be at least minTextLength, and must differ from original.
    if (
      state.settings.cleanTodoText &&
      attrs.cleaned_text &&
      typeof attrs.cleaned_text === "string"
    ) {
      const cleaned = attrs.cleaned_text.trim();
      const looksValid =
        cleaned.includes("{{[[TODO]]}}") &&
        cleaned.length >= state.settings.minTextLength &&
        cleaned.length < (originalText || "").length &&
        cleaned !== originalText;
      if (looksValid) {
        try {
          await window.roamAlphaAPI.data.block.update({
            block: { uid: parentUid, string: cleaned },
          });
          log("info", `cleaned title [${parentUid}]: ${(originalText.length - cleaned.length)} chars dropped`);
        } catch (e) {
          log("warn", `cleaned-text update failed [${parentUid}]`, e);
        }
      } else if (cleaned) {
        log("debug", `skipped cleaned_text (failed guards)`, { cleaned, originalText });
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
    if (state.settings.requireConfirmation) {
      log("info", "(suggestion-only mode) attrs:", attrs);
      await logToRoam(uid, attrs, "suggestion-only");
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
    add("Auto-Attribute: toggle clean-text (rewrite TODO title)", () => {
      state.settings.cleanTodoText = !state.settings.cleanTodoText;
      log("info", `cleanTodoText: ${state.settings.cleanTodoText}`);
    });
    add("Auto-Attribute: toggle dropdown mode (BT_attrProject)", () => {
      state.settings.useDropdown = !state.settings.useDropdown;
      log("info", `useDropdown: ${state.settings.useDropdown} — ${state.settings.useDropdown ? "new TODOs will get {{or:}} dropdown" : "new TODOs will get flat [[Project]]"}`);
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
          const newStr = `BT_attrProject:: {{or: [[${project}]]}}`;
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
