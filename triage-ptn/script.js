/* triage-ptn v1.0.4 — log entries use plain [uid] text instead of ((uid)) refs
 * (avoids polluting source-block backlink count). Same change as auto-attribute-todo v1.0.4.
 */
/* triage-ptn v1.0.3 — STOP RETRY LOOP (same fix as auto-attribute-todo v1.0.3):
 * mark uid as attempted-today before LLM call, so failures don't retry on the
 * 10-min scan. Reduce scan budget to 10 per cycle. Bump scan interval to 20 min.
 */
/* triage-ptn v1.0.0
 *
 * Watches for blocks tagged with #ptn (process-this-now mobile capture) and
 * suggests a classification + route via LiveAI_API. Does NOT auto-mutate —
 * inserts a single suggestion child block with a clear "Accept" / "Reject"
 * action via two follow-up child blocks the user clicks.
 *
 * Classifications: task | journal | decision | reference | obsolete
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.0.4";
  const NAMESPACE = "triage-ptn";
  const TAG_PAGE = "ptn";
  const LOG_PAGE = "Triage PTN Log";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 8000,            // mobile capture often comes in bursts; wait
    minTextLength: 8,
    dailyCallCap: 80,
    scanIntervalMs: 20 * 60_000,  // safety scan every 20 min (was 10)
    scanBudgetPerCycle: 10,        // max blocks to schedule per scan
    contextPages: ["Time Block Constraints", "Chief of Staff/Memory"],
  };

  const state = {
    settings: { ...DEFAULTS },
    pending: new Map(),
    processedToday: new Set(),
    callsToday: 0,
    callsResetDate: new Date().toDateString(),
    scanTimer: null,
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

  function ordinal(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }
  function formatRoamDate(off = 0) {
    const d = new Date(); d.setDate(d.getDate() + off);
    const m = ["January","February","March","April","May","June",
               "July","August","September","October","November","December"];
    return `[[${m[d.getMonth()]} ${d.getDate()}${ordinal(d.getDate())}, ${d.getFullYear()}]]`;
  }

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

  /* Robust JSON parse — handles raw JSON, ```json fences, ``` fences,
   * and leading/trailing prose. Returns null on failure. */
  function parseJsonResponse(text) {
    if (!text || typeof text !== "string") return null;
    let s = text.trim();
    if (s.startsWith("```")) {
      s = s.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
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

  async function logToRoam(uid, classification, error) {
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
      // Plain [uid] text instead of ((uid)) to avoid backlink pollution.
      const summary = error
        ? `${ts} FAIL [${uid}]: ${error}`
        : `${ts} [${uid}] → ${classification.classification} (conf ${(classification.confidence ?? 0).toFixed(2)})`;
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": pageUid, order: "last" },
        block: { string: `${formatRoamDate(0)} ${summary}` },
      });
    } catch (e) { log("warn", "log failed", e); }
  }

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
    // Mark as attempted-today UP FRONT so any failure path doesn't loop.
    state.processedToday.add(uid);
    persistProcessed();

    const c = await classify(uid, text);
    if (!c) { await logToRoam(uid, null, "no result"); return; }
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
    const add = (l, cb) => {
      try { window.roamAlphaAPI.ui.commandPalette.addCommand({ label: l, callback: cb }); }
      catch (e) { log("warn", `add cmd: ${l}`, e); }
    };
    add("Triage PTN: process focused block now", async () => {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (!f) return log("info", "no focused");
      state.processedToday.delete(f["block-uid"]);
      await processBlock(f["block-uid"]);
    });
    add("Triage PTN: toggle enabled", () => {
      state.settings.enabled = !state.settings.enabled;
      log("info", `enabled: ${state.settings.enabled}`);
    });
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
    add("Triage PTN: stats", () => {
      log("info", "stats", {
        version: VERSION,
        enabled: state.settings.enabled,
        callsToday: state.callsToday,
        processedToday: state.processedToday.size,
        pending: state.pending.size,
      });
    });
  }

  function init() {
    log("info", `v${VERSION} starting`);
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
  }
  window[`${NAMESPACE}_cleanup`] = cleanup;
  init();
})();
