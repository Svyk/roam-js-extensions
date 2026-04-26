/* lori-review-button v1.0.0
 *
 * Adds command-palette commands to run a Lori-Boyd-style QA review on the
 * current page (typically a SOP, deviation, EMP doc). Reads the page content
 * via roamContext and inserts review comments as nested children under a
 * "Lori Review — [time]" heading at the bottom of the page.
 *
 * Two modes:
 *   - Full review: all 6 Lori-style passes
 *   - Quick scan: only data-without-context + ambiguous language (fast)
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.0.0";
  const NAMESPACE = "lori-review-button";

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");

  function ordinal(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }
  function nowLabel() {
    const d = new Date();
    const m = ["January","February","March","April","May","June",
               "July","August","September","October","November","December"];
    const date = `${m[d.getMonth()]} ${d.getDate()}${ordinal(d.getDate())}, ${d.getFullYear()}`;
    const time = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `${date} ${time}`;
  }

  function currentPageUid() {
    // Try the focused-block's page first; fall back to the visible main page
    try {
      const f = window.roamAlphaAPI.ui.getFocusedBlock();
      if (f?.["page-uid"]) return f["page-uid"];
    } catch {}
    try {
      return window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
    } catch {}
    return null;
  }

  function getPageTitle(uid) {
    try {
      const p = window.roamAlphaAPI.data.pull("[:node/title]", [":block/uid", uid]);
      return p?.[":node/title"] || null;
    } catch { return null; }
  }

  async function runReview({ mode }) {
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return;
    }
    const pageUid = currentPageUid();
    if (!pageUid) {
      log("warn", "could not detect current page");
      return;
    }
    const title = getPageTitle(pageUid);
    if (!title) {
      log("warn", `not on a page (uid=${pageUid}) — open a SOP/deviation/document page first`);
      return;
    }

    log("info", `running ${mode} review on [[${title}]]`);

    // Create the parent header block first (we'll get its uid from the response)
    const headerUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid: headerUid, string: `**Lori Review — ${nowLabel()}** _(${mode})_` },
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
      await window.LiveAI_API.generate({
        prompt: `Review the page [[${title}]] per the system prompt.`,
        systemPrompt: mode === "full" ? fullSystemPrompt : quickSystemPrompt,
        useDefaultSystemPrompt: false,
        roamContext: {
          page: true,
          pageArgument: [title],
          pageViewUid: pageUid,
        },
        output: "insert",
        targetUid: headerUid,
        caller: `${NAMESPACE}/${VERSION}`,
      });
      log("info", `${mode} review complete on [[${title}]]`);
    } catch (e) {
      log("error", `review failed on [[${title}]]`, e);
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": headerUid, order: 0 },
        block: { string: `_(error: ${e.message || "unknown"})_` },
      });
    }
  }

  function registerCommands() {
    const add = (label, cb) => {
      try { window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback: cb }); }
      catch (e) { log("warn", `add cmd: ${label}`, e); }
    };
    add("Lori Review: full (6-pass)", () => runReview({ mode: "full" }));
    add("Lori Review: quick scan (data + ambiguous)", () => runReview({ mode: "quick" }));
  }

  function init() {
    log("info", `v${VERSION} starting`);
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, reviews will fail until LiveAI loads.");
    }
    registerCommands();
    log("info", "ready — open a SOP/deviation page, run 'Lori Review' from cmd palette");
  }
  init();
})();
