/* timeblock-organizer v1.1.6
 *
 * v1.1.6 — Expanded conflict-ignore tag list. The original v1.1.4 `#concurrent`
 *   marker was a single-tag opt-out, but real overlaps include several
 *   non-conflicting categories that all deserve the same treatment:
 *     - Calendar / agenda-anchor events that already account for parallel work
 *       (you tag them `#calendar` so the planner sees them, but they shouldn't
 *       flag conflicts with real focus blocks)
 *     - All-day events (`#allday` / `#all-day`) — they span the whole day by
 *       definition and conflicting with them is meaningless
 *     - Early-out / leaving-early markers (`#leaving-early` / `#early-out`) —
 *       they're flags on the schedule, not conflicting time blocks
 *   New setting `conflictIgnoreMarkers` is a comma-separated list with sensible
 *   defaults. If EITHER block in an overlapping pair contains ANY of the
 *   listed tags (including the existing `concurrentMarker`), the pair is
 *   skipped in `detectOverlaps`. The existing `concurrentMarker` setting still
 *   works (its single value is merged into the ignore list on every reconcile),
 *   so no settings-page migration is needed for v1.1.5 users.
 *
 * v1.1.5 — Hotfix: TimeBlock parent detection broken by Nautilus retirement
 *   (Roam block ((bw1QibZxU)) on 2026-05-07). The default `timeblockSignature`
 *   was the legacy Nautilus render prefix
 *   (`"#TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs))"`). After the
 *   render component was retired, daily-page TimeBlock parents became plain
 *   `#TimeBlock` blocks, which no longer matched the prefix → `findTimeBlockUid`
 *   returned null → reconcile silently no-op'd, leaving entries unsorted.
 *   Fix: `timeblockSignature` is now a TAG (`#TimeBlock` default), and
 *   `findTimeBlockUid` matches `^<tag>(\s|$)` — accepts both legacy form
 *   (with the render text after a space) AND the new plain form. Excludes
 *   accidental matches like `#TimeBlocked`. Existing user settings on
 *   [[TimeBlock Organizer Settings]] with the old long-prefix value need
 *   to be edited to just `#TimeBlock` for the matcher to pick up the new
 *   regex form (the user's settings-page value still wins over DEFAULTS).
 *
 * v1.1.4 — Three improvements driven by 2026-05-06 use:
 *   (a) `#concurrent` opt-out for intentional overlaps. The Phase 2 conflict
 *       detector flagged every overlapping pair, but sometimes Svyat is
 *       working on two things at once (long meeting + flexible Plodding
 *       task running in parallel) and the `**TimeBlock Conflicts**` status
 *       block is just noise. New `concurrentMarker` setting (default
 *       `#concurrent`) — if EITHER block in an overlapping pair contains
 *       the marker, the pair is skipped in `detectOverlaps`. The
 *       `#pinned-time` mechanism (which only blocks auto-bumping) is
 *       unchanged — `#concurrent` is a separate, narrower opt-out that
 *       suppresses the warning entirely.
 *   (b) Loose-sort fallback for incomplete time entries. The strict
 *       parseTimePrefix has three regexes (range, TODO-prefixed, single
 *       timestamp), all requiring `\s+(?=\S)` after the time — so entries
 *       like bare `19:00 ` (just the time, no description yet) or
 *       `{{[[TODO]]}} 19:00 thing` (time mid-text after a tool marker)
 *       fall through to "untimed" and historically got parked at the top
 *       of the TimeBlock as `tbOther`. New `looseParseTimePrefix` scans
 *       the first 30 chars for any HH:MM and returns it as a sort hint
 *       only — never used to rewrite the block. Default ON via
 *       `looseSortFallback`. Entries that even loose-parsing can't time
 *       still bucket to "untimed".
 *   (c) Untimed entries park at BOTTOM, not top. Before v1.1.4 anything
 *       that didn't parse as time-prefixed was placed at the start of the
 *       TimeBlock (the design intent was "park unsorted stuff visible at
 *       the top"), but practically it pushed every real time-entry down a
 *       row and made the day's chronology start at item 2+. Default
 *       `untimedAtBottom: true` flips it: incomplete drafts drift to the
 *       end where they're easy to finish, real entries lead the timeline.
 *       Set `untimedAtBottom:: false` on the settings page to restore the
 *       legacy ordering.
 *
 * v1.1.3 — Two parser fixes that left entries stuck out of order at the
 *   top of TimeBlock children, surfaced by a 2026-05-02 reconcile of
 *   ((oNbgd_kU2)):
 *   (a) `eh > 23` rejection of 24:00 end times. `23:30 - 24:00 EOD wrap`
 *       failed parseTimePrefix, got bucketed as tbOther, parked at the top
 *       of the sorted output. 24:00 is canonical end-of-day (1440 min) and
 *       should be valid as an END time (not a start). Now allows eh=24
 *       only when em=0; eh > 24 or 24:01+ stays invalid.
 *   (b) Single-timestamp entries (no range) like `20:51 {{⇥🕞:SmartBlock:
 *       Elapsed time}} ...` from SmartBlock click-loggers were treated as
 *       tbOther and parked at the top. Added SINGLE_TIME_PREFIX_RE as the
 *       third parse fallback. Treated as zero-duration points: sort by
 *       start time, never overlap (filter on endMin > startMin in
 *       detectOverlaps), never auto-bumped (rewriteTimePrefix doesn't
 *       handle the single shape — leaves them where the user put them).
 *
 * v1.1.2 — Chief of Staff compatibility. COS's `roam_create_todo` tool
 *   prepends `{{[[TODO]]}} ` to whatever text the agent passes, so a COS-
 *   scheduled item ends up shaped `{{[[TODO]]}} HH:MM - HH:MM description`
 *   — TODO marker FIRST, time range SECOND. v1.1.1's regex required the
 *   time range to be at position 0 of the string, so COS items got treated
 *   as `tbOther` and never sorted. Added TODO_TIME_PREFIX_RE that catches
 *   the marker-first shape. parseTimePrefix tries canonical first, falls
 *   back to tool-prefixed. rewriteTimePrefix preserves whichever shape was
 *   used (won't rewrite COS output to canonical — that'd surprise the user).
 *   Now reconciles + sorts ANY writer's output: COS, Better Tasks dropdowns,
 *   manual edits, future skills.
 *
 * v1.1.1 — Bugfix: relaxed TIME_PREFIX_RE so it matches all five canonical
 *   TimeBlock entry formats, not just inline-TODO entries. The prior regex
 *   required `HH:MM - HH:MM ` followed IMMEDIATELY by `{{[[TODO]]}}`, which
 *   excluded:
 *     - block-ref entries: `HH:MM - HH:MM ((uid))`
 *     - markdown-link wrapped block refs: `HH:MM - HH:MM [text](((uid)))`
 *     - meeting/event entries: `HH:MM - HH:MM **call with X**`
 *     - any plain-text time-prefixed line
 *   Fix: regex now matches `HH:MM - HH:MM ` followed by any content (positive
 *   lookahead `(?=\S)`). Bare `HH:MM - HH:MM` alone with no description still
 *   doesn't match (intentional — incomplete entry). rewriteTimePrefix
 *   simplified to a literal string replacement; no longer rebuilds TODO/DONE
 *   markers from scratch (they live AFTER the prefix and survive verbatim).
 *   Repro that prompted the fix: ((HU-11_ihG)) — `23:00 - 23:45 [{{[[TODO]]}}
 *   ...](((OImadoY9X))) #important` was sitting mid-stack in TimeBlock when
 *   it should've sorted to position N-1 (just before the SmartBlock button).
 *
 * v1.1.0 — Phase 2 + Phase 3 ship.
 *   Phase 2 (conflict detection): after each reconcile, scan the sorted
 *   TimeBlock children for overlapping time ranges. If conflicts exist,
 *   write a `**TimeBlock Conflicts** (N) #timeblock-status` block as the
 *   LAST child of the daily page with one bullet per overlapping pair
 *   (e.g. `09:00-10:00 "EMP review" overlaps 09:30-10:30 "swab walk" —
 *   30min`). Block is auto-deleted when zero conflicts remain. Always-on
 *   console warning regardless of status-block setting.
 *   Phase 3 (auto-resolve, opt-in): when `auto_resolve_conflicts` is on
 *   and `conflict_strategy` is `bump_forward`, the script rewrites the
 *   later item's time prefix to start at the earlier item's end, cascading
 *   forward. Refuses (and reports as a dead-end in the status block) if
 *   the cascade pushes past `cascade_cutoff_time` (default 23:00). Items
 *   tagged with `#pinned-time` are skipped (you decided their time
 *   intentionally; we won't move them).
 *
 * v1.0.0 — Phase 1: watches daily pages and reorganizes time-prefixed
 *   TODOs into the #TimeBlock parent, sorted by start-time. Pins the
 *   SmartBlock timestamp button as last child. Pull-watches today +
 *   tomorrow + historically-visited daily pages within a window. LRU-
 *   capped, debounced, idempotent.
 *
 * Bug it solves: when COS (or any tool) writes a `14:00 - 15:00 {{[[TODO]]}}
 * foo` block to today's daily page as a direct page-level child, this
 * plugin's pull-watch fires, the block gets moved under TimeBlock at the
 * right time-sorted position, the SmartBlock button stays pinned at the
 * end, and (v1.1.0) any time conflicts get reported / auto-resolved.
 *
 * No LLM call. Pure Roam datalog + block.move/update. Cost: $0.
 */
;(function () {
  const VERSION = "1.1.6";
  const NAMESPACE = "timeblock-organizer";
  const SETTINGS_PAGE = "TimeBlock Organizer Settings";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 8000,                      // coalesce burst writes
    historicalWindowDays: 7,               // how far back to auto-watch on navigation
    maxActiveWatches: 14,                  // LRU cap
    timeblockSignature: "#TimeBlock",
    smartblockButtonSignature: "{{🕗↦:SmartBlock:Double timestamp buttons2}}",
    sweepIntervalMs: 5 * 60_000,           // periodic reconcile in case watches miss edits
    rolloverCheckMs: 60_000,               // how often to check for date rollover
    suppressMs: 2000,                      // ignore watch fires from our own writes
    dryRun: false,                         // log moves without executing
    verbose: false,
    // v1.1.0 Phase 2: conflict detection
    conflictDetection: true,               // scan for overlapping ranges after each reconcile
    conflictStatusBlock: true,             // write a status block on the daily page
    // v1.1.0 Phase 3: auto-resolve (opt-in)
    autoResolveConflicts: false,           // off by default — you might WANT overlaps
    conflictStrategy: "bump_forward",      // only one strategy supported for now
    cascadeCutoffTime: "23:00",            // refuse to bump past this (HH:MM)
    pinnedMarker: "#pinned-time",          // items with this tag don't get bumped
    // v1.1.4
    concurrentMarker: "#concurrent",       // overlap pair where EITHER block has this tag is intentional — skip the conflict warning
    conflictIgnoreMarkers: "#calendar, #calender, #allday, #all-day, #leaving-early, #early-out, #out-early", // v1.1.6: comma-separated additional ignore tags. Merged with `concurrentMarker` on every reconcile. Calendar/all-day/early-out events are flags on the schedule, not real conflicts.
    looseSortFallback: true,               // when strict regex fails, scan first 30 chars for HH:MM and sort by that anyway (catches in-progress edits like "19:00 " or "{{[[TODO]]}} 19:00 thing"); never rewrites the block
    untimedAtBottom: true,                 // when an entry can't be timed even loosely, park it at the BOTTOM of the TimeBlock (not the top — that was the surprise)
  };

  const state = {
    settings: { ...DEFAULTS },
    activeWatches: new Map(),              // pageUid → { unsub, lastUsed }
    pendingReconciles: new Map(),          // pageUid → debounce timer
    suppressUntil: 0,                      // ms timestamp; ignore watches before this
    sweepTimer: null,
    rolloverTimer: null,
    cachedTodayUid: null,
    navigationListenerAttached: false,
    registeredCommandLabels: new Set(),
  };

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");
  const sk = (k) => `${NAMESPACE}:${k}`;
  const debug = (msg, data) => { if (state.settings.verbose) log("debug", msg, data); };

  /* ---------- Settings ---------- */
  const GRAPH_SETTINGS = [
    ["enabled",                     "enabled",                   "bool",   true,
      "Master switch. false = no watches, no reconciles, the plugin is dormant."],
    ["debounce_ms",                 "debounceMs",                "int",    8000,
      "ms to wait after a daily-page change before reconciling. Coalesces burst writes from COS / Better Tasks."],
    ["historical_window_days",      "historicalWindowDays",      "int",    7,
      "How many days back to auto-register watches when you navigate to a historical daily page. 0 = today + tomorrow only."],
    ["max_active_watches",          "maxActiveWatches",          "int",    14,
      "Cap on simultaneously-watched daily pages. LRU evicts when exceeded."],
    ["timeblock_signature",         "timeblockSignature",        "string", DEFAULTS.timeblockSignature,
      "TAG that identifies the TimeBlock parent block on a daily page. Default `#TimeBlock`. v1.1.5+: matched as `^<tag>(\\s|$)` — block must START with the tag followed by whitespace or end-of-string. Permits both legacy form (`#TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs))...}}`) and post-2026-05-07 plain `#TimeBlock`. Edit if you renamed the tag (e.g. `#tb`)."],
    ["smartblock_button_signature", "smartblockButtonSignature", "string", DEFAULTS.smartblockButtonSignature,
      "Exact string of the SmartBlock timestamp-button block that must always be the last child of TimeBlock. If you renamed it, paste the new exact string here."],
    ["sweep_interval_ms",           "sweepIntervalMs",           "int",    300000,
      "Periodic reconcile sweep over all watched pages. Catches edits that pull-watch on :block/children misses (e.g. text-only changes that add a time prefix)."],
    ["rollover_check_ms",           "rolloverCheckMs",           "int",    60000,
      "How often to check whether the date has rolled over (so today's daily page changes uid)."],
    ["suppress_ms",                 "suppressMs",                "int",    2000,
      "After we issue our own block.move calls, ignore watch callbacks for this many ms (avoids self-triggered loops)."],
    ["dry_run",                     "dryRun",                    "bool",   false,
      "Log every move that WOULD be executed, without actually moving blocks. Useful for previewing behavior."],
    ["verbose",                     "verbose",                   "bool",   false,
      "Verbose console logging. Off by default — most operations are silent."],
    // Phase 2: conflict detection
    ["conflict_detection",          "conflictDetection",         "bool",   true,
      "After each reconcile, scan TimeBlock children for overlapping time ranges. Off = no conflict warnings at all."],
    ["conflict_status_block",       "conflictStatusBlock",       "bool",   true,
      "Write a `**TimeBlock Conflicts** (N) #timeblock-status` block on the daily page when overlaps exist. Auto-deleted when zero conflicts. Off = console-only warnings."],
    // Phase 3: auto-resolve
    ["auto_resolve_conflicts",      "autoResolveConflicts",      "bool",   false,
      "Auto-rewrite conflicting time prefixes (bump the later item forward by the overlap). OFF by default — you might intentionally want overlaps. Only takes effect when conflict_detection is also on."],
    ["conflict_strategy",           "conflictStrategy",          "string", "bump_forward",
      "Resolution strategy. Only `bump_forward` supported in v1.1.0 — push the later item's start to the earlier item's end, cascading forward."],
    ["cascade_cutoff_time",         "cascadeCutoffTime",         "string", "23:00",
      "If a cascade would push an item to start past this time (HH:MM, 24h), refuse the resolution and flag the item as a dead-end in the status block. Default 23:00 (no scheduling past 11pm)."],
    ["pinned_marker",               "pinnedMarker",              "string", "#pinned-time",
      "Substring/tag that marks an item as user-pinned. Pinned items are NEVER auto-bumped, even if they're the cause of a cascade dead-end. Add this tag to a TODO to lock its time."],
    // v1.1.4 ──────────────────────────────────────────────────────────────────
    ["concurrent_marker",           "concurrentMarker",          "string", "#concurrent",
      "Substring/tag for blocks that may legitimately overlap. If EITHER block in an overlapping pair contains this tag, the pair is treated as intentional concurrent work and is NOT flagged in the **TimeBlock Conflicts** status block. Use when you're working on two things at once (e.g. a long meeting that runs in parallel with a flexible Plodding task)."],
    // v1.1.6 ──────────────────────────────────────────────────────────────────
    ["conflict_ignore_markers",     "conflictIgnoreMarkers",     "string", "#calendar, #calender, #allday, #all-day, #leaving-early, #early-out, #out-early",
      "Comma-separated list of additional tags whose presence on EITHER block in an overlapping pair causes the pair to be skipped in conflict detection. Merged with the single `concurrent_marker` setting on every reconcile. Defaults cover calendar/agenda anchors, all-day events, and early-departure markers — none of those should flag as time conflicts with real focus blocks. Add/remove tags as needed. Leave empty to disable the multi-tag list (then only `concurrent_marker` applies)."],
    ["loose_sort_fallback",         "looseSortFallback",         "bool",   true,
      "When strict regex fails (incomplete entries like '19:00 ' with nothing after, or '{{[[TODO]]}} 19:00 thing' with the time mid-text), scan the first 30 chars for any HH:MM and sort the block by that time anyway. Never rewrites the block — sort-only. Off = old strict behavior where any non-strict block lands in the bucketed group."],
    ["untimed_at_bottom",           "untimedAtBottom",           "bool",   true,
      "Park entries that can't be timed (even with loose-sort fallback) at the BOTTOM of the TimeBlock rather than the top. False = legacy behavior (untimed at top). Bottom is less surprising — incomplete entries drift to the end where you can finish them."],
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

  /* ---------- Roam helpers ---------- */
  function todayPageUid() {
    try { return window.roamAlphaAPI.util.dateToPageUid(new Date()); } catch { return null; }
  }
  function tomorrowPageUid() {
    try {
      const t = new Date(); t.setDate(t.getDate() + 1);
      return window.roamAlphaAPI.util.dateToPageUid(t);
    } catch { return null; }
  }
  function offsetPageUid(offsetDays) {
    try {
      const d = new Date(); d.setDate(d.getDate() + offsetDays);
      return window.roamAlphaAPI.util.dateToPageUid(d);
    } catch { return null; }
  }

  function getDirectChildren(parentUid) {
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid :block/string :block/order]}]",
        [":block/uid", parentUid]
      );
      const children = (data?.[":block/children"] || [])
        .map(c => ({
          uid: c[":block/uid"],
          string: c[":block/string"] || "",
          order: c[":block/order"] || 0,
        }))
        .sort((a, b) => a.order - b.order);
      return children;
    } catch (e) {
      debug("getDirectChildren failed", { parentUid, err: e?.message || e });
      return [];
    }
  }

  function findTimeBlockUid(dailyPageUid) {
    // v1.1.5: signature is now a leading TAG (e.g. "#TimeBlock"), not a full
    // prefix string. Match if the block starts with the tag followed by
    // whitespace OR end-of-string. This catches:
    //   - "#TimeBlock"                                              (post-2026-05-07, nautilus retired)
    //   - "#TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs)) ...}}"  (legacy, still works)
    //   - "#TimeBlock #pinned-time"                                  (custom suffixes)
    // and EXCLUDES "#TimeBlocked", "#TimeBlocking", etc.
    const sig = state.settings.timeblockSignature;
    if (!sig) return null;
    // Build regex from the tag — escape regex metacharacters in case the
    // user configured a fancy signature.
    const escSig = sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("^" + escSig + "(?:\\s|$)");
    const children = getDirectChildren(dailyPageUid);
    for (const c of children) {
      if (re.test(c.string)) return c.uid;
    }
    return null;
  }

  /* ---------- parsing ---------- */
  // Two accepted shapes for time-prefixed blocks:
  //   (A) Canonical Svy format — time range FIRST:
  //         HH:MM - HH:MM <anything>
  //         HH:MM - HH:MM {{[[TODO]]}} description
  //         HH:MM - HH:MM ((block-uid))
  //         HH:MM - HH:MM [text](((block-uid)))
  //         HH:MM - HH:MM **bold meeting** description
  //   (B) Tool-prefixed format — TODO/DONE marker FIRST, time range SECOND:
  //         {{[[TODO]]}} HH:MM - HH:MM description
  //         {{[[DONE]]}} HH:MM - HH:MM done thing
  //       Chief of Staff's roam_create_todo and similar writers prepend the
  //       marker automatically, producing this shape. We sort/reconcile them
  //       too — without rewriting them to canonical (would surprise the user).
  // Lookahead `(?=\S)` requires content after the time range — bare
  // `HH:MM - HH:MM` alone won't match. Tolerates en-dash and optional
  // whitespace around the dash.
  const TIME_PREFIX_RE = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s+(?=\S)/;
  const TODO_TIME_PREFIX_RE = /^(\{\{\[\[(?:TODO|DONE)\]\]\}\}\s+)(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s+(?=\S)/;
  // v1.1.3 (C) Single-timestamp entries — SmartBlock elapsed-time logs
  // and similar point-in-time markers. Zero duration → sort-only support;
  // detectOverlaps filters on endMin > startMin so they never conflict;
  // rewriteTimePrefix tests RANGE patterns first and falls through, so
  // single-stamp entries are never auto-bumped (the user's choice of when
  // they clicked the timestamp is preserved).
  const SINGLE_TIME_PREFIX_RE = /^(\d{1,2}):(\d{2})\s+(?=\S)/;

  function parseTimePrefix(blockString) {
    if (!blockString) return null;
    // Try canonical shape (A) first
    let m = blockString.match(TIME_PREFIX_RE);
    let sh, sm, eh, em;
    if (m) {
      sh = parseInt(m[1], 10); sm = parseInt(m[2], 10);
      eh = parseInt(m[3], 10); em = parseInt(m[4], 10);
    } else {
      // Try tool-prefixed shape (B)
      m = blockString.match(TODO_TIME_PREFIX_RE);
      if (m) {
        sh = parseInt(m[2], 10); sm = parseInt(m[3], 10);
        eh = parseInt(m[4], 10); em = parseInt(m[5], 10);
      } else {
        // Try single-timestamp shape (C). Zero duration: endMin == startMin.
        m = blockString.match(SINGLE_TIME_PREFIX_RE);
        if (!m) return null;
        sh = parseInt(m[1], 10); sm = parseInt(m[2], 10);
        eh = sh; em = sm;
      }
    }
    // v1.1.3: 24:00 is canonical end-of-day (1440 min) and must be allowed
    // as an END time (not start). 24:01+ stays invalid.
    if (sh > 23 || sm > 59 || em > 59) return null;
    if (eh > 24 || (eh === 24 && em > 0)) return null;
    return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
  }

  function isTimePrefixed(s) {
    return parseTimePrefix(s) !== null;
  }

  /* v1.1.4 — loose sort fallback. When parseTimePrefix returns null (the
   * three strict regexes don't match), scan the first 30 chars for any
   * HH:MM and return its startMin so the block can still sort by intended
   * time. Catches in-progress entries: bare "19:00" with no description
   * yet, "{{[[TODO]]}} 19:00 thing" with the time mid-text after a tool
   * marker, or "[[some link]] 19:00 description" with leading content.
   * Never used to rewrite — pure sort hint. Returns null if no usable
   * HH:MM is in the head. */
  const LOOSE_TIME_RE = /\b(\d{1,2}):(\d{2})\b/;
  function looseParseTimePrefix(s) {
    if (!s || !state.settings.looseSortFallback) return null;
    const head = s.slice(0, 30);
    const m = head.match(LOOSE_TIME_RE);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mn = parseInt(m[2], 10);
    if (h > 23 || mn > 59) return null;
    return h * 60 + mn;
  }

  /* Combined sort hint: strict parse takes priority (preserves existing
   * end-time-based sort tie-breaking by returning the full {startMin,
   * endMin} structure indirectly via parseTimePrefix), and loose parse
   * fills in for everything else. Used by the bucketing logic below. */
  function sortHint(s) {
    const strict = parseTimePrefix(s);
    if (strict) return strict.startMin;
    return looseParseTimePrefix(s);
  }

  function isSmartBlockButton(s) {
    return s === state.settings.smartblockButtonSignature;
  }

  function isPinned(s) {
    const marker = state.settings.pinnedMarker;
    return marker && s.includes(marker);
  }

  function formatMinAsHHMM(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "00:00";
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function parseCutoffTime(hhmm) {
    if (!hhmm || typeof hhmm !== "string") return 23 * 60;
    const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 23 * 60;
    const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (h > 23 || mm > 59) return 23 * 60;
    return h * 60 + mm;
  }

  /* Replace the leading time range with new times — preserves whichever shape
   * the block uses (canonical-first or tool-prefixed). Everything after the
   * time range survives verbatim (TODO marker, block ref, markdown link, tags,
   * anything). Returns the original string unchanged if neither pattern fits. */
  function rewriteTimePrefix(blockString, newStartMin, newEndMin) {
    const sh = formatMinAsHHMM(newStartMin);
    const eh = formatMinAsHHMM(newEndMin);
    if (TIME_PREFIX_RE.test(blockString)) {
      return blockString.replace(TIME_PREFIX_RE, `${sh} - ${eh} `);
    }
    if (TODO_TIME_PREFIX_RE.test(blockString)) {
      // Preserve the marker prefix (capture group 1: `{{[[TODO]]}} ` or `{{[[DONE]]}} `)
      return blockString.replace(TODO_TIME_PREFIX_RE, (_match, marker) => `${marker}${sh} - ${eh} `);
    }
    return blockString;
  }

  /* ---------- Phase 2: conflict detection ---------- */
  /**
   * Given items already sorted by startMin asc, return the list of overlapping
   * pairs. Each pair: { a, b, overlapMinutes }. Skips zero-duration items
   * (no time to overlap) and malformed ones (end < start).
   */
  function detectOverlaps(sortedItems) {
    const conflicts = [];
    // v1.1.6: merge the single `concurrentMarker` with the multi-tag
    // `conflictIgnoreMarkers` list into one set of substrings. EITHER block
    // in an overlapping pair carrying ANY of these tags skips the conflict.
    const concurrentMarker = state.settings.concurrentMarker;
    const ignoreList = String(state.settings.conflictIgnoreMarkers || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (concurrentMarker) ignoreList.push(concurrentMarker);
    const ignoreSet = Array.from(new Set(ignoreList));
    const containsIgnoreTag = (str) => {
      for (const tag of ignoreSet) {
        if (str.includes(tag)) return true;
      }
      return false;
    };
    const parsed = sortedItems
      .map(it => ({ ...it, t: parseTimePrefix(it.string) }))
      .filter(it => it.t && it.t.endMin > it.t.startMin);
    for (let i = 0; i < parsed.length; i++) {
      const a = parsed[i];
      for (let j = i + 1; j < parsed.length; j++) {
        const b = parsed[j];
        if (b.t.startMin >= a.t.endMin) break; // sorted; no further overlaps with a
        if (ignoreSet.length && (containsIgnoreTag(a.string) || containsIgnoreTag(b.string))) {
          continue;
        }
        const overlapStart = Math.max(a.t.startMin, b.t.startMin);
        const overlapEnd = Math.min(a.t.endMin, b.t.endMin);
        if (overlapEnd > overlapStart) {
          conflicts.push({ a, b, overlapMinutes: overlapEnd - overlapStart });
        }
      }
    }
    return conflicts;
  }

  function shortDescription(blockString) {
    // Strip "HH:MM - HH:MM {{[[TODO/DONE]]}} " prefix; truncate.
    const stripped = blockString.replace(TIME_PREFIX_RE, "").trim();
    if (stripped.length <= 50) return stripped;
    return stripped.slice(0, 47) + "…";
  }

  function timeRangeOf(item) {
    const t = parseTimePrefix(item.string);
    if (!t) return "??:??";
    return `${formatMinAsHHMM(t.startMin)}-${formatMinAsHHMM(t.endMin)}`;
  }

  /* ---------- Phase 3: bump_forward auto-resolve ---------- */
  /**
   * Walk sorted items left-to-right. For each pair where curr.startMin <
   * prev.endMin AND curr is not pinned, rewrite curr's start to prev.endMin
   * (preserving duration). If the new end exceeds cutoff, abort and report
   * the dead-end. Returns { ok, updates, deadEnds }.
   *
   * Note: this is destructive on the input array's `t` field (mutates the
   * working copy). Callers should map item.string updates from `updates`.
   */
  function resolveConflicts(items, cutoffMin) {
    const working = items
      .map(it => ({
        uid: it.uid,
        originalString: it.string,
        currentString: it.string,
        t: parseTimePrefix(it.string),
        pinned: isPinned(it.string),
      }))
      .filter(it => it.t);
    const updates = [];
    const deadEnds = [];

    for (let i = 1; i < working.length; i++) {
      const prev = working[i - 1];
      const curr = working[i];
      if (curr.t.startMin >= prev.t.endMin) continue; // no overlap
      if (curr.pinned) {
        deadEnds.push({
          item: curr,
          reason: `pinned (${state.settings.pinnedMarker}) — refusing to bump`,
        });
        continue;
      }
      const duration = curr.t.endMin - curr.t.startMin;
      const newStart = prev.t.endMin;
      const newEnd = newStart + duration;
      if (newEnd > cutoffMin) {
        deadEnds.push({
          item: curr,
          reason: `cascade past cutoff: would end ${formatMinAsHHMM(newEnd)} > ${formatMinAsHHMM(cutoffMin)}`,
        });
        continue;
      }
      curr.t = { startMin: newStart, endMin: newEnd };
      curr.currentString = rewriteTimePrefix(curr.currentString, newStart, newEnd);
      updates.push({
        uid: curr.uid,
        oldString: curr.originalString,
        newString: curr.currentString,
        bumpedFrom: parseTimePrefix(curr.originalString),
        bumpedTo: { startMin: newStart, endMin: newEnd },
      });
    }
    return { updates, deadEnds };
  }

  /* ---------- status block management (Phase 2) ---------- */
  const STATUS_BLOCK_PREFIX = "**TimeBlock Conflicts**";

  function findStatusBlockUid(pageUid) {
    const children = getDirectChildren(pageUid);
    for (const c of children) {
      if (c.string.startsWith(STATUS_BLOCK_PREFIX)) return c.uid;
    }
    return null;
  }

  async function deleteStatusBlock(pageUid) {
    const uid = findStatusBlockUid(pageUid);
    if (!uid) return false;
    try {
      await window.roamAlphaAPI.data.block.delete({ block: { uid } });
      return true;
    } catch (e) {
      log("warn", `delete status block ${uid} failed`, e?.message || e);
      return false;
    }
  }

  async function ensureStatusBlock(pageUid, conflicts, deadEnds) {
    if (!state.settings.conflictStatusBlock) return;
    const total = conflicts.length + deadEnds.length;
    if (total === 0) {
      await deleteStatusBlock(pageUid);
      return;
    }
    const headerString = `${STATUS_BLOCK_PREFIX} (${total}) #timeblock-status`;
    let statusUid = findStatusBlockUid(pageUid);
    if (!statusUid) {
      statusUid = window.roamAlphaAPI.util.generateUID();
      try {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": pageUid, order: "last" },
          block: { uid: statusUid, string: headerString, open: false },
        });
      } catch (e) {
        log("warn", `create status block failed`, e?.message || e);
        return;
      }
    } else {
      try {
        await window.roamAlphaAPI.data.block.update({
          block: { uid: statusUid, string: headerString },
        });
      } catch (e) {
        log("warn", `update status block string failed`, e?.message || e);
      }
    }
    // Wipe existing children and rewrite
    const existing = getDirectChildren(statusUid);
    for (const c of existing) {
      try { await window.roamAlphaAPI.data.block.delete({ block: { uid: c.uid } }); }
      catch {}
    }
    let order = 0;
    for (const conf of conflicts) {
      const aDesc = `${timeRangeOf(conf.a)} "${shortDescription(conf.a.string)}"`;
      const bDesc = `${timeRangeOf(conf.b)} "${shortDescription(conf.b.string)}"`;
      const line = `${aDesc} overlaps ${bDesc} — ${conf.overlapMinutes}min`;
      try {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": statusUid, order },
          block: { string: line },
        });
        order++;
      } catch (e) { log("debug", `conflict line create failed`, e?.message || e); }
    }
    for (const de of deadEnds) {
      const desc = `${timeRangeOf(de.item)} "${shortDescription(de.item.originalString)}"`;
      const line = `Dead-end: ${desc} — ${de.reason}`;
      try {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": statusUid, order },
          block: { string: line },
        });
        order++;
      } catch (e) { log("debug", `dead-end line create failed`, e?.message || e); }
    }
  }

  /* ---------- the core: reconcile ---------- */
  /**
   * Compute desired order for TimeBlock children:
   *   [time-prefixed TODOs sorted by startMin asc, ..., SmartBlock button(s) last]
   *
   * Items already under TimeBlock that AREN'T time-prefixed AND aren't the
   * SmartBlock button stay where they are (we don't reorder them).
   *
   * Items at the daily-page level that ARE time-prefixed get pulled into
   * TimeBlock at the right position.
   */
  function computeDesiredOrder(pageUid, tbUid) {
    const pageChildren = getDirectChildren(pageUid);
    const tbChildren = getDirectChildren(tbUid);

    const pageLevelMisplaced = pageChildren.filter(c =>
      c.uid !== tbUid && isTimePrefixed(c.string)
    );

    const tbButtons = tbChildren.filter(c => isSmartBlockButton(c.string));

    // v1.1.4 — three-way bucketing instead of two:
    //   strictly-timed: parseTimePrefix returns a real {startMin, endMin}
    //   loosely-timed:  strict fails BUT looseParseTimePrefix finds an HH:MM
    //   untimed:        no usable time at all
    // Strictly + loosely-timed merge into one chronologically-sorted
    // sequence; untimed entries drop to the BOTTOM (config: untimedAtBottom)
    // so they're easy to finish/triage rather than parked at the top.
    const nonButtonChildren = tbChildren.filter(c => !isSmartBlockButton(c.string));
    const tbStrictTimed = nonButtonChildren.filter(c => isTimePrefixed(c.string));
    const tbLooseTimed = nonButtonChildren.filter(c =>
      !isTimePrefixed(c.string) && looseParseTimePrefix(c.string) !== null
    );
    const tbUntimed = nonButtonChildren.filter(c =>
      !isTimePrefixed(c.string) && looseParseTimePrefix(c.string) === null
    );

    // pageLevelMisplaced is already filtered to isTimePrefixed-only by line
    // 698-700, so it's all strict — merge into the timed group.
    const allTimed = [
      ...tbStrictTimed.map(c => ({ c, sort: parseTimePrefix(c.string).startMin })),
      ...tbLooseTimed.map(c => ({ c, sort: looseParseTimePrefix(c.string) })),
      ...pageLevelMisplaced.map(c => ({ c, sort: parseTimePrefix(c.string).startMin })),
    ];
    allTimed.sort((a, b) => a.sort - b.sort);
    const allTodos = allTimed.map(x => x.c);

    // Final desired sequence — depends on `untimedAtBottom`:
    //   true (default since v1.1.4): timed entries first, untimed at bottom,
    //                                SmartBlock button last
    //   false (legacy):              untimed first, timed sorted, button last
    const desired = state.settings.untimedAtBottom
      ? [...allTodos, ...tbUntimed, ...tbButtons]
      : [...tbUntimed, ...allTodos, ...tbButtons];

    return {
      desired,
      pageLevelMisplaced,
      currentTbChildren: tbChildren,
    };
  }

  function isAlreadyOrganized(desired, currentTbChildren, pageLevelMisplaced) {
    if (pageLevelMisplaced.length > 0) return false;
    if (currentTbChildren.length !== desired.length) return false;
    for (let i = 0; i < desired.length; i++) {
      if (currentTbChildren[i].uid !== desired[i].uid) return false;
    }
    return true;
  }

  async function reconcileTimeBlock(pageUid, reason = "watch") {
    if (!state.settings.enabled) return;
    const tbUid = findTimeBlockUid(pageUid);
    if (!tbUid) {
      debug(`no TimeBlock parent on page ${pageUid} — skip`);
      return;
    }
    const { desired, pageLevelMisplaced, currentTbChildren } = computeDesiredOrder(pageUid, tbUid);

    const alreadyOrganized = isAlreadyOrganized(desired, currentTbChildren, pageLevelMisplaced);

    if (!alreadyOrganized) {
      const moveCount = pageLevelMisplaced.length + desired.filter((d, i) =>
        currentTbChildren[i]?.uid !== d.uid
      ).length;
      log("info", `reconciling TimeBlock on ${pageUid} (${reason}): ${pageLevelMisplaced.length} pulled in + reorder, ${moveCount} block.moves`);

      if (state.settings.dryRun) {
        log("info", `[dry-run] would move into order:`, desired.map(d => ({
          uid: d.uid,
          preview: d.string.slice(0, 50),
        })));
      } else {
        state.suppressUntil = Date.now() + state.settings.suppressMs;
        const api = window.roamAlphaAPI.data.block;
        let executed = 0, failed = 0;
        for (const item of desired) {
          try {
            await api.move({
              location: { "parent-uid": tbUid, order: "last" },
              block: { uid: item.uid },
            });
            executed++;
          } catch (e) {
            log("warn", `move failed for ${item.uid}`, e?.message || e);
            failed++;
          }
        }
        if (failed > 0) log("warn", `reconcile complete with ${failed} failures (${executed} ok)`);
      }
    } else {
      debug(`page ${pageUid} already organized (${desired.length} children)`);
    }

    // ── Phase 3: auto-resolve conflicts (opt-in) ───────────────────────
    let resolvedUpdates = [];
    if (state.settings.conflictDetection && state.settings.autoResolveConflicts && !state.settings.dryRun) {
      const finalChildren = getDirectChildren(tbUid);
      const todos = finalChildren.filter(c => isTimePrefixed(c.string));
      const cutoff = parseCutoffTime(state.settings.cascadeCutoffTime);
      const result = resolveConflicts(todos, cutoff);
      if (result.updates.length > 0) {
        state.suppressUntil = Date.now() + state.settings.suppressMs;
        const api = window.roamAlphaAPI.data.block;
        for (const u of result.updates) {
          try {
            await api.update({ block: { uid: u.uid, string: u.newString } });
            resolvedUpdates.push(u);
            log("info", `bumped ((${u.uid})): ${formatMinAsHHMM(u.bumpedFrom.startMin)} → ${formatMinAsHHMM(u.bumpedTo.startMin)}`);
          } catch (e) {
            log("warn", `bump failed for ${u.uid}`, e?.message || e);
          }
        }
        if (resolvedUpdates.length > 0) {
          // After mutations, re-sort: time prefixes changed, so order may need refresh
          const refreshedChildren = getDirectChildren(tbUid);
          const refreshedTodos = refreshedChildren.filter(c => isTimePrefixed(c.string));
          const refreshedSorted = [...refreshedTodos].sort((a, b) =>
            parseTimePrefix(a.string).startMin - parseTimePrefix(b.string).startMin
          );
          // Compare against current order; if drift, re-move into sorted sequence
          let needsResort = false;
          for (let i = 0; i < refreshedTodos.length; i++) {
            if (refreshedTodos[i].uid !== refreshedSorted[i].uid) { needsResort = true; break; }
          }
          if (needsResort) {
            const buttons = refreshedChildren.filter(c => isSmartBlockButton(c.string));
            const others = refreshedChildren.filter(c =>
              !isTimePrefixed(c.string) && !isSmartBlockButton(c.string)
            );
            const finalDesired = [...others, ...refreshedSorted, ...buttons];
            for (const item of finalDesired) {
              try { await api.move({ location: { "parent-uid": tbUid, order: "last" }, block: { uid: item.uid } }); }
              catch (e) { log("warn", `post-bump re-sort move failed for ${item.uid}`, e?.message || e); }
            }
          }
        }
      }
    }

    // ── Phase 2: conflict detection + status block ─────────────────────
    if (state.settings.conflictDetection) {
      const finalChildren = getDirectChildren(tbUid);
      const todos = finalChildren.filter(c => isTimePrefixed(c.string));
      const conflicts = detectOverlaps(todos);
      // Re-detect dead-ends from any updates we attempted (resolveConflicts
      // returned them above — they apply even after partial bumps).
      let deadEnds = [];
      if (state.settings.autoResolveConflicts) {
        const cutoff = parseCutoffTime(state.settings.cascadeCutoffTime);
        const result = resolveConflicts(todos, cutoff); // re-run to detect any remaining
        deadEnds = result.deadEnds;
      }
      if (conflicts.length > 0 || deadEnds.length > 0) {
        log("warn", `${conflicts.length} conflict(s)${deadEnds.length ? ` + ${deadEnds.length} dead-end(s)` : ""} on page ${pageUid}`);
        for (const c of conflicts) {
          log("warn", `  ${timeRangeOf(c.a)} "${shortDescription(c.a.string)}" overlaps ${timeRangeOf(c.b)} "${shortDescription(c.b.string)}" (${c.overlapMinutes}min)`);
        }
        for (const de of deadEnds) {
          log("warn", `  dead-end: ${timeRangeOf(de.item)} "${shortDescription(de.item.originalString)}" — ${de.reason}`);
        }
        if (!state.settings.dryRun) {
          state.suppressUntil = Date.now() + state.settings.suppressMs;
          await ensureStatusBlock(pageUid, conflicts, deadEnds);
        }
      } else {
        if (!state.settings.dryRun) {
          state.suppressUntil = Date.now() + state.settings.suppressMs;
          await deleteStatusBlock(pageUid);
        }
      }
    }
  }

  function scheduleReconcile(pageUid, reason) {
    if (state.pendingReconciles.has(pageUid)) {
      clearTimeout(state.pendingReconciles.get(pageUid));
    }
    const t = setTimeout(() => {
      state.pendingReconciles.delete(pageUid);
      reconcileTimeBlock(pageUid, reason).catch(e =>
        log("warn", `reconcile threw on ${pageUid}`, e?.message || e)
      );
    }, state.settings.debounceMs);
    state.pendingReconciles.set(pageUid, t);
  }

  /* ---------- watches ---------- */
  function registerWatch(pageUid, reason) {
    if (state.activeWatches.has(pageUid)) {
      const w = state.activeWatches.get(pageUid);
      w.lastUsed = Date.now();
      return;
    }
    if (state.activeWatches.size >= state.settings.maxActiveWatches) {
      // Evict LRU
      let oldestUid = null, oldestTs = Infinity;
      for (const [uid, w] of state.activeWatches) {
        if (w.lastUsed < oldestTs) { oldestTs = w.lastUsed; oldestUid = uid; }
      }
      if (oldestUid) {
        try { state.activeWatches.get(oldestUid).unsub(); } catch {}
        state.activeWatches.delete(oldestUid);
        debug(`LRU evicted watch on ${oldestUid}`);
      }
    }
    const cb = () => {
      if (Date.now() < state.suppressUntil) {
        debug(`watch on ${pageUid} fired but suppressed (self-triggered)`);
        return;
      }
      scheduleReconcile(pageUid, "watch");
    };
    try {
      window.roamAlphaAPI.data.addPullWatch(
        "[{:block/children [:block/uid :block/string :block/order]}]",
        [":block/uid", pageUid],
        cb
      );
      state.activeWatches.set(pageUid, {
        unsub: () => {
          try {
            window.roamAlphaAPI.data.removePullWatch(
              "[{:block/children [:block/uid :block/string :block/order]}]",
              [":block/uid", pageUid],
              cb
            );
          } catch {}
        },
        lastUsed: Date.now(),
        registeredAt: Date.now(),
      });
      debug(`registered watch on ${pageUid} (${reason}) — ${state.activeWatches.size} active`);
      // Reconcile once on registration to clean up any pre-existing mess
      scheduleReconcile(pageUid, `${reason}-initial`);
    } catch (e) {
      log("warn", `addPullWatch failed for ${pageUid}`, e?.message || e);
    }
  }

  function unregisterWatch(pageUid) {
    const w = state.activeWatches.get(pageUid);
    if (!w) return;
    try { w.unsub(); } catch {}
    state.activeWatches.delete(pageUid);
    if (state.pendingReconciles.has(pageUid)) {
      clearTimeout(state.pendingReconciles.get(pageUid));
      state.pendingReconciles.delete(pageUid);
    }
    debug(`unregistered watch on ${pageUid}`);
  }

  /* ---------- timers: rollover + sweep ---------- */
  function checkRollover() {
    const newToday = todayPageUid();
    if (!newToday) return;
    if (newToday === state.cachedTodayUid) return;
    log("info", `date rollover detected: ${state.cachedTodayUid} → ${newToday}`);
    state.cachedTodayUid = newToday;
    registerWatch(newToday, "rollover-today");
    const newTomorrow = tomorrowPageUid();
    if (newTomorrow) registerWatch(newTomorrow, "rollover-tomorrow");
  }

  async function periodicSweep() {
    if (!state.settings.enabled) return;
    debug(`periodic sweep over ${state.activeWatches.size} watched pages`);
    for (const [pageUid] of state.activeWatches) {
      try { await reconcileTimeBlock(pageUid, "sweep"); }
      catch (e) { debug(`sweep reconcile failed on ${pageUid}`, e?.message || e); }
    }
  }

  /* ---------- navigation listener ---------- */
  function onPageNavigation() {
    if (!state.settings.enabled) return;
    let openUid;
    try { openUid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); }
    catch { return; }
    if (!openUid) return;
    // Is it a daily page within window?
    const window_ = state.settings.historicalWindowDays;
    for (let i = -window_; i <= 1; i++) {
      if (openUid === offsetPageUid(i)) {
        registerWatch(openUid, `nav-${i}`);
        return;
      }
    }
  }

  function attachNavigationListener() {
    if (state.navigationListenerAttached) return;
    // Roam doesn't expose a clean event for page navigation in its public API.
    // Listen for hash changes (Roam routes via `/page/<uid>` in the hash) and
    // also do a low-frequency check from the rollover timer.
    const handler = () => onPageNavigation();
    window.addEventListener("hashchange", handler);
    state._navHandler = handler;
    state.navigationListenerAttached = true;
  }

  function detachNavigationListener() {
    if (!state.navigationListenerAttached) return;
    if (state._navHandler) {
      try { window.removeEventListener("hashchange", state._navHandler); } catch {}
      state._navHandler = null;
    }
    state.navigationListenerAttached = false;
  }

  /* ---------- commands ---------- */
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

    add("TimeBlock Organizer: open settings page (edit toggles inline)", async () => {
      try { await ensureSettingsPage(true); log("info", "Settings page opened in right sidebar"); }
      catch (e) { log("error", "ensureSettingsPage failed", e); }
    });
    add("TimeBlock Organizer: reload settings from graph", () => {
      const u = loadAllSettingsFromGraph();
      log("info", u > 0 ? `${u} setting(s) reloaded` : "no setting changes detected");
    });
    add("TimeBlock Organizer: toggle enabled (master switch)", toggleSetting("enabled", "enabled", "enabled"));
    add("TimeBlock Organizer: toggle dry-run mode", toggleSetting("dry_run", "dryRun", "dryRun"));
    add("TimeBlock Organizer: toggle verbose logging", toggleSetting("verbose", "verbose", "verbose"));
    add("TimeBlock Organizer: toggle conflict detection (Phase 2)", toggleSetting("conflict_detection", "conflictDetection", "conflictDetection"));
    add("TimeBlock Organizer: toggle conflict status block on daily page", toggleSetting("conflict_status_block", "conflictStatusBlock", "conflictStatusBlock"));
    add("TimeBlock Organizer: toggle auto-resolve conflicts (Phase 3, opt-in)", toggleSetting("auto_resolve_conflicts", "autoResolveConflicts", "autoResolveConflicts"));
    add("TimeBlock Organizer: show conflicts on current page", async () => {
      let openUid;
      try { openUid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); }
      catch {}
      if (!openUid) return log("warn", "no open page detected");
      const tbUid = findTimeBlockUid(openUid);
      if (!tbUid) return log("info", `no TimeBlock parent on ${openUid}`);
      const finalChildren = getDirectChildren(tbUid);
      const todos = finalChildren.filter(c => isTimePrefixed(c.string));
      const conflicts = detectOverlaps(todos);
      const cutoff = parseCutoffTime(state.settings.cascadeCutoffTime);
      const { deadEnds } = resolveConflicts(todos, cutoff);
      if (conflicts.length === 0 && deadEnds.length === 0) {
        log("info", "no conflicts on this page");
        try { alert("No conflicts on this page."); } catch {}
        return;
      }
      const lines = [
        `${conflicts.length} conflict(s), ${deadEnds.length} dead-end(s):`,
        "",
        ...conflicts.map(c =>
          `• ${timeRangeOf(c.a)} "${shortDescription(c.a.string)}" overlaps ${timeRangeOf(c.b)} "${shortDescription(c.b.string)}" — ${c.overlapMinutes}min`
        ),
        ...deadEnds.map(de =>
          `× dead-end: ${timeRangeOf(de.item)} "${shortDescription(de.item.originalString)}" — ${de.reason}`
        ),
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });
    add("TimeBlock Organizer: reconcile current page now", async () => {
      let openUid;
      try { openUid = window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(); }
      catch {}
      if (!openUid) return log("warn", "no open page detected");
      await reconcileTimeBlock(openUid, "manual");
    });
    add("TimeBlock Organizer: reconcile today + tomorrow", async () => {
      const today = todayPageUid();
      const tomorrow = tomorrowPageUid();
      if (today) await reconcileTimeBlock(today, "manual-today");
      if (tomorrow) await reconcileTimeBlock(tomorrow, "manual-tomorrow");
    });
    add("TimeBlock Organizer: show stats (current settings)", () => {
      const onOff = (b) => b ? "ON " : "OFF";
      const lines = [
        `timeblock-organizer v${VERSION}`,
        ``,
        `── toggles ──`,
        `  ${onOff(state.settings.enabled)} enabled (master switch)`,
        `  ${onOff(state.settings.dryRun)} dry-run mode`,
        `  ${onOff(state.settings.verbose)} verbose logging`,
        `  ${onOff(state.settings.conflictDetection)} conflict detection (Phase 2)`,
        `  ${onOff(state.settings.conflictStatusBlock)} status block on daily page`,
        `  ${onOff(state.settings.autoResolveConflicts)} auto-resolve conflicts (Phase 3, opt-in)`,
        ``,
        `── runtime ──`,
        `  Active watches: ${state.activeWatches.size} / ${state.settings.maxActiveWatches}`,
        `  Pending reconciles: ${state.pendingReconciles.size}`,
        `  Today UID: ${state.cachedTodayUid || "(none)"}`,
        `  TimeBlock signature: ${state.settings.timeblockSignature.slice(0, 60)}...`,
        `  SmartBlock button: ${state.settings.smartblockButtonSignature}`,
        `  Debounce: ${state.settings.debounceMs}ms / sweep: ${state.settings.sweepIntervalMs / 60000}min`,
        `  Conflict strategy: ${state.settings.conflictStrategy} / cutoff: ${state.settings.cascadeCutoffTime} / pinned marker: ${state.settings.pinnedMarker}`,
        ``,
        `Watched pages:`,
        ...Array.from(state.activeWatches.entries()).map(([uid, w]) =>
          `  - ${uid} (last used ${Math.round((Date.now() - w.lastUsed) / 1000)}s ago)`
        ),
        ``,
        `Edit any setting via cmd palette → "open settings page", or paste new toggles into [[${SETTINGS_PAGE}]].`,
      ];
      console.log(lines.join("\n"));
      try { alert(lines.join("\n")); } catch {}
    });
    add("TimeBlock Organizer: list active watches (debug)", () => {
      console.table(Array.from(state.activeWatches.entries()).map(([uid, w]) => ({
        page_uid: uid,
        registered_at: new Date(w.registeredAt).toLocaleString(),
        last_used_sec_ago: Math.round((Date.now() - w.lastUsed) / 1000),
      })));
    });
  }

  /* ---------- init / cleanup ---------- */
  function init() {
    log("info", `v${VERSION} starting`);
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

    if (state.settings.enabled) {
      state.cachedTodayUid = todayPageUid();
      if (state.cachedTodayUid) registerWatch(state.cachedTodayUid, "init-today");
      const tomorrow = tomorrowPageUid();
      if (tomorrow) registerWatch(tomorrow, "init-tomorrow");
      attachNavigationListener();
      state.rolloverTimer = setInterval(checkRollover, state.settings.rolloverCheckMs);
      state.sweepTimer = setInterval(() => {
        periodicSweep().catch(e => log("warn", "sweep threw", e?.message || e));
      }, state.settings.sweepIntervalMs);
    } else {
      log("warn", "enabled=false — running in dormant mode (no watches, no reconciles)");
    }

    window[`${NAMESPACE}_state`] = state;
    log("info", `ready. ${state.activeWatches.size} watches active.`);
  }

  function cleanup() {
    if (state.rolloverTimer) clearInterval(state.rolloverTimer);
    if (state.sweepTimer) clearInterval(state.sweepTimer);
    for (const t of state.pendingReconciles.values()) clearTimeout(t);
    state.pendingReconciles.clear();
    for (const [uid, w] of state.activeWatches) {
      try { w.unsub(); } catch {}
    }
    state.activeWatches.clear();
    detachNavigationListener();
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
