/* daily-summary v1.0.0
 *
 * One-button daily-page summary widget. Adds a command-palette command:
 * "Daily Summary: refresh top-of-day". When run, reads today's daily page +
 * its linked references, generates a 2-sentence "what's actually happening
 * today" summary, and writes it as a top block under a "Today's Vibe ::"
 * header. Re-running overwrites in place (idempotent).
 *
 * NOT a real-time watcher — explicit-trigger only to keep cost predictable.
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.0.0";
  const NAMESPACE = "daily-summary";
  const HEADER = "Today's Vibe ::";

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");

  function ordinal(d) {
    if (d >= 11 && d <= 13) return "th";
    return ({1:"st",2:"nd",3:"rd"})[d % 10] || "th";
  }
  function todayPageTitle() {
    const d = new Date();
    const m = ["January","February","March","April","May","June",
               "July","August","September","October","November","December"];
    return `${m[d.getMonth()]} ${d.getDate()}${ordinal(d.getDate())}, ${d.getFullYear()}`;
  }
  function todayPageUid() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}-${dd}-${d.getFullYear()}`;
  }

  function getPageChildren(pageUid) {
    return window.roamAlphaAPI.data.pull(
      "[{:block/children [:block/uid :block/string :block/order]}]",
      [":block/uid", pageUid]
    );
  }

  function findOrCreateHeaderBlock(pageUid) {
    const data = getPageChildren(pageUid);
    const ch = (data?.[":block/children"]) || [];
    const existing = ch.find(c => (c[":block/string"] || "").startsWith(HEADER));
    return existing ? existing[":block/uid"] : null;
  }

  async function ensureHeaderBlock(pageUid) {
    const existing = findOrCreateHeaderBlock(pageUid);
    if (existing) {
      // Wipe its existing children so re-runs don't accumulate
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid]}]", [":block/uid", existing]
      );
      for (const c of (data?.[":block/children"] || [])) {
        await window.roamAlphaAPI.data.block.delete({ block: { uid: c[":block/uid"] } });
      }
      return existing;
    }
    const newUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": pageUid, order: 0 },
      block: { uid: newUid, string: `${HEADER} _(refresh via cmd-palette: "Daily Summary")_` },
    });
    return newUid;
  }

  async function refresh() {
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return;
    }
    const pageUid = todayPageUid();
    log("info", `refreshing for ${todayPageTitle()} (uid=${pageUid})`);
    const headerUid = await ensureHeaderBlock(pageUid);
    if (!headerUid) {
      log("error", "could not create/find header block");
      return;
    }
    try {
      await window.LiveAI_API.generate({
        prompt: "Summarize what's happening today. Keep it to 2 sentences. Lead with the top priority. End with one observation about energy / vibe / momentum.",
        systemPrompt:
          "You are a brief daily-vibe summarizer for Svyatoslav (Svy) Kleshchev. Read today's daily page + linked refs. Output 2 sentences max, plain prose, no headers, no bullets, no lists. Honest tone — if the day looks chaotic say so; if it's quiet say so. Reference specific items by name when useful. No throat-clearing openers.",
        useDefaultSystemPrompt: false,
        roamContext: {
          page: true,
          pageArgument: [todayPageTitle()],
          linkedRefs: true,
          linkedRefsArgument: [todayPageTitle()],
        },
        output: "insert",
        targetUid: headerUid,
        caller: `${NAMESPACE}/${VERSION}`,
      });
      log("info", "refresh complete");
    } catch (e) {
      log("error", "refresh failed", e);
    }
  }

  function registerCommands() {
    const add = (label, cb) => {
      try { window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback: cb }); }
      catch (e) { log("warn", `add cmd: ${label}`, e); }
    };
    add("Daily Summary: refresh top-of-day", refresh);
    add("Daily Summary: refresh tomorrow's prep", async () => {
      // Same flow but for [[tomorrow]] — useful for evening planning glance
      if (!window.LiveAI_API?.isAvailable()) return log("warn", "no LiveAI");
      const t = new Date(); t.setDate(t.getDate() + 1);
      const m = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];
      const tomorrowTitle = `${m[t.getMonth()]} ${t.getDate()}${ordinal(t.getDate())}, ${t.getFullYear()}`;
      const tomorrowUid = `${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}-${t.getFullYear()}`;
      // Ensure the daily page exists
      try {
        await window.roamAlphaAPI.data.page.create({
          page: { title: tomorrowTitle, uid: tomorrowUid },
        });
      } catch {}  // already exists is fine
      const headerUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": tomorrowUid, order: 0 },
        block: { uid: headerUid, string: "Tomorrow's Outlook ::" },
      });
      try {
        await window.LiveAI_API.generate({
          prompt: "Outline what tomorrow looks like in 2-3 sentences. Lead with the top priority. Note any meetings or hard deadlines.",
          systemPrompt:
            "Brief outlook for tomorrow. Read [[tomorrow]] daily page + recent open Better Tasks. 2-3 sentences max, plain prose. Reference specific tasks by name.",
          useDefaultSystemPrompt: false,
          roamContext: {
            page: true, pageArgument: [tomorrowTitle],
            linkedRefs: true, linkedRefsArgument: [tomorrowTitle],
          },
          output: "insert",
          targetUid: headerUid,
          caller: `${NAMESPACE}/${VERSION}`,
        });
        log("info", "tomorrow outlook complete");
      } catch (e) {
        log("error", "tomorrow outlook failed", e);
      }
    });
  }

  function init() {
    log("info", `v${VERSION} starting`);
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, refresh will fail until LiveAI loads.");
    }
    registerCommands();
    log("info", "ready — open command palette: 'Daily Summary'");
  }
  init();
})();
