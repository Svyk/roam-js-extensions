/* auto-attribute-todo v1.8.11
 *
 * v1.8.11 — Two changes addressing the v1.8.7 "remove from processedToday on
 *   null result" backfire AND the v1.8.4 startup-catchup "old TODOs flood"
 *   complaint (Roam block ((H-3kgQz8m)) "Need to disable tos auto attribute
 *   startup-catch up it's too many todos and really old ones today"):
 *   (1) `enableStartupCatchup` (default FALSE). v1.8.4 added an unbounded
 *       catch-up scan on every init() to drain the off-hours backlog. In
 *       practice this re-queues weeks-old un-attributable TODOs on every
 *       Roam tab open, dominates the dailyCallCap, and re-tries blocks the
 *       LLM has already declined. Opt-in only — the cmd-palette "rescue
 *       backlog" (also added in v1.8.7) is the right surface for manual
 *       drain when needed. Live pull-watch + periodic scan still catch
 *       genuinely-new TODOs at the moment they're written.
 *   (2) `maxRetriesPerDay: 3` per-UID retry budget. Failure case ((H-3kgQz8m)):
 *       a single TODO accumulated 31 "no result" log entries over 16 hours —
 *       one per scan interval — because v1.8.7's "remove from processedToday
 *       on null result" treated EVERY null as transient. It isn't. Some TODOs
 *       are legitimately unattributable: meta-tasks ("disable feature X"),
 *       prose-heavy entries the LLM declines, blocks whose only child is an
 *       image (the multimodal-image-URL-in-context appears to be the trigger
 *       here — when child = `![](firebase.png.enc)` LiveAI's roamContext
 *       pulls the encrypted URL into the prompt, and the model returns
 *       unparseable text). Bumping a per-UID counter on every null/throw
 *       and KEEPING the UID in processedToday once the count hits N gives
 *       transient failures their retries (default 3) while permanently
 *       skipping legit unattributable blocks for the rest of the day. Counter
 *       resets at midnight along with processedToday. Persists to localStorage
 *       alongside processedToday so script reloads don't reset the budget.
 *
 *   Also added: cmd-palette "show retry counts (debug)" to see which UIDs
 *   are accumulating failures.
 *
 * v1.8.10 — Deterministic relative-date stripping. Failure case
 *   (Roam block ((kjl82B-Q0)) 2026-05-11): user wrote
 *   "{{[[TODO]]}} Build sanitary weekly schedule this Thursday".
 *   Auto-attribute correctly inferred BT_attrDue:: [[May 14th, 2026]],
 *   but the title still read "this Thursday" — redundant + brittle
 *   (the phrase will drift wrong-meaning next week). The deprecated
 *   `cleanTodoText` LLM feature would have caught this but it was
 *   turned off in v1.7.10 because the LLM over-stripped parens
 *   content and #tags.
 *
 *   Fix: deterministic regex stripper, runs AFTER BT_attrDue is
 *   written. Closed set of patterns:
 *     - "(this|next|last|on) (Monday-Sunday)"
 *     - "(today|tomorrow|yesterday|tonight)"
 *     - "(this|next|last) (week|month|year|weekend|morning|...)"
 *     - "(by|before|after|until|due) (the above)"
 *   All anchored to `\s*$` (end of string) so mid-title matches like
 *   "Schedule next week's meeting" stay alone — only trailing phrases
 *   get stripped. Applied iteratively (capped 5 passes) so chained
 *   tails work. New setting `strip_relative_dates::` (default true)
 *   on the settings page; turn off to opt out.
 *
 * v1.8.9 — Explicit template-page exclusion. `roam/templates` and
 *   `roam/js/smartblocks/workflows` were already caught by the
 *   `startsWith("roam/")` filter in both `isExcludedFromAttribution`
 *   and the `findAllTodos` datalog. v1.8.9 adds a user-editable
 *   `templatePages` setting (graph key `template_pages::`,
 *   comma-separated) so users whose template/workflow pages live
 *   OUTSIDE the `roam/` namespace can name them by title and have
 *   their TODOs ignored. Default value lists the two `roam/*` ones
 *   explicitly for clarity. Also added `"csv"` type to the settings
 *   parser so comma-separated lists round-trip cleanly between the
 *   graph (string form) and runtime (array form).
 *
 * v1.8.8 — Hotfix: master-switch-after-long-off-period unleashed
 *   simultaneous storm. Failure case (Roam, May 10 evening): user's
 *   `enabled` master switch had been OFF for an extended period →
 *   silent backlog of unattributed TODOs accumulated. Flipped ON
 *   in the cmd palette + invoked v1.8.7's "rescue backlog" → the
 *   unbounded `findAllTodos()` queued every backlog item via
 *   `schedule(uid)`, all with the same `debounceMs` (5s default).
 *   ~5 seconds later, dozens of `processBlock` ran in parallel →
 *   dozens of simultaneous LiveAI calls + Roam BT_attr writes →
 *   Roam's sync queue saturated → graph hung; user couldn't even
 *   open the cmd palette to disable.
 *
 *   Three changes:
 *   (1) Stagger. `schedule(uid, extraDelayMs)` takes an extra delay
 *       so the catchup/rescue can offset each item. Periodic scan
 *       stays unstaggered (budget keeps batch small). Default
 *       `catchupStaggerMs: 250` → ~4 attributions/sec → 100 items
 *       in 25s instead of ~0s. Pull-watch on live typing still has
 *       extraDelayMs=0; per-block latency stays low.
 *   (2) Confirmation prompt. Pre-count eligible backlog. If
 *       `unbounded` AND `eligible > catchupConfirmAbove` (default
 *       30), `window.confirm()` with cost + duration estimate
 *       BEFORE clearing processedToday or queuing anything. User
 *       can Cancel to abort. The catchup-on-init path also asks.
 *   (3) Same in the rescue cmd-palette: pre-count, prompt, then
 *       stagger.
 *
 * v1.8.7 — Two changes addressing "TODO never attributed" failure mode
 *   (Roam block ((ulEJoZC0R)) "Plan out EMP swabs today" still failing
 *   on May 10 after v1.8.6 shipped):
 *   (1) `processBlock` line 2604 adds the UID to `processedToday` BEFORE
 *       the LLM call as an anti-loop guard (v1.0.3 pattern). But the
 *       failure paths — `attribute()` returns null (LiveAI hiccup,
 *       transient API error) and `insertAttrs()` throws (Roam sync
 *       error) — left the UID in `processedToday`. Once persisted to
 *       localStorage by `persistProcessed()`, the block was permanently
 *       skipped for the rest of the day even across script reloads.
 *       Fix: remove from `processedToday` on those two transient
 *       failure paths so the next scan retries. Race-skipped and
 *       suggestion-only paths intentionally stay — those are successful
 *       terminations, not failures.
 *   (2) New cmd-palette: "Auto-Attribute: rescue backlog (force-process
 *       all unattributed)". One button that clears `processedToday` AND
 *       runs an unbounded scan. Use when a TODO won't attribute and the
 *       cause is ambiguous (stuck in cache vs fell out of 25-window vs
 *       earlier transient failure).
 *
 * v1.8.6 — `findAllTodos()` 25-cap was silently capping the v1.8.4
 *   "unbounded catch-up scan" — the budget bypass in `runScanCycle`
 *   didn't matter because the underlying datalog query only returned
 *   the top-25 most-recently-edited TODOs. Failure case (Roam block
 *   ((ulEJoZC0R)) "Plan out EMP swabs today" on May 10): older
 *   un-attributed TODOs that fell out of the top-25 window — because
 *   25+ newer edits buried them — were stuck forever; neither
 *   pull-watch (missed if Roam tab wasn't focused at type-time),
 *   nor catchup (25-cap), nor periodic scan (25-cap) could rescue
 *   them. Fix: `findAllTodos({limit})` takes an explicit limit;
 *   default stays 25 for the periodic-scan throttle, but the catchup
 *   call site passes `Infinity` to drain the entire backlog. The
 *   "Auto-Attribute: scan now" cmd-palette also upgraded to no-cap
 *   — user-explicit invocation should not be throttled.
 *
 * v1.8.5 — Hotfix: 60-second post-reload blackout window. Failure case
 *   (Roam block ((0sN1hc9QR))): user reloaded v1.8.4, immediately
 *   typed a fresh `{{[[TODO]]}}` on today's daily page, no
 *   attribution fired. Root cause: line 424 of the state initializer
 *   set `networkOnlineSince: Date.now()` at every IIFE init. Combined
 *   with the v1.8.1 `pauseReason()` "online-grace" check (which bails
 *   when `Date.now() - state.networkOnlineSince < pauseGraceMs`,
 *   default 60s), this meant EVERY script reload silently skipped
 *   the v1.8.4 catch-up scan and any pull-watch fires for the first
 *   60 seconds after reload. The grace was designed for offline→online
 *   transitions (let Roam's sync queue drain after reconnect) — it
 *   shouldn't apply at initial script load, where there's no
 *   transition. Fix: `networkOnlineSince: 0` at init. The `online`
 *   event handler and "Auto-Attribute: resume now" cmd-palette
 *   resume both still set `Date.now()` explicitly when grace is
 *   genuinely warranted.
 *
 * v1.8.4 — Off-hours-write attribution gap. Failure case (Roam task
 *   ((SduPiN4v7)) / fix block ((96K0Ncq3l))): deep-dream's 03:00
 *   LaunchAgent wrote `{{[[TODO]]}} review-queue: 6 pending | ...` via
 *   the Roam Alpha API. Auto-attribute didn't fire because (a) the
 *   pull-watch only triggers when the Roam tab is loaded — wasn't, at
 *   3 AM; (b) the periodic scan also only runs while the tab is loaded.
 *   When the user opened Roam ~10 AM the first scan was up to 30 min
 *   later (per v1.8.3) AND `scanBudgetPerCycle: 10` would have dribbled
 *   any backlog of >10 TODOs out across multiple cycles. Fix: on init(),
 *   after settings load, run a one-shot `runScanCycle({ unbounded: true })`
 *   that queues the entire missing-BT_attrProject backlog with no budget
 *   cap. The downstream LLM dispatcher + pause-on-network logic still
 *   rate-limits actual API calls, so "no cap" only affects how many
 *   blocks enter the queue — not how fast they leave it. Item 8b
 *   (cross-session `processedToday` persistence) was already shipped as
 *   `loadProcessed`/`persistProcessed` localStorage keyed by date.
 *
 * v1.8.3 — Scan interval compromise: 60min → 30min. The v1.8.2 quartering
 *   was based on a misdiagnosis of the sync failure mode (assumed outbound
 *   write pressure). 2026-05-07 evidence proved it was INBOUND apply lag
 *   from nautilus' reactive reads — fixed by retiring nautilus, not by
 *   throttling writes. 30 min keeps the lower-write benefit (vs. v1.8.0's
 *   15) without making new TODOs wait up to an hour for attribution. The
 *   pause-on-network-pressure + parallel BT_attr writes from v1.8.2 stay
 *   — both are genuine improvements regardless of which side of sync was
 *   the bottleneck.
 *
 * v1.8.2 — Network-pressure resilience for work-WiFi sync storms (Roam task
 *   ((SduPiN4v7))). Three changes addressing the residual queue saturation
 *   the user observed at the office even after disabling auto-attribute:
 *   (a) Default scan interval 15min → 60min. Each scan cycle hub-syncs,
 *       reloads settings, refreshes embeddings, and prunes the log — all
 *       writes to Roam. Quartering the scan rate cuts the script's
 *       background write contribution by 4× without losing functionality
 *       (the pullwatch on the [[TODO]] page still catches new TODOs in
 *       real time; scan is just the safety net for missed edits).
 *   (b) Pause-on-network-pressure. Listens to `online`/`offline` browser
 *       events. While offline, processBlock skips all work — no LLM
 *       calls, no BT_attr writes, no scans. After the browser reports
 *       back online, a 60s grace window (`pauseGraceMs`) lets Roam's own
 *       sync queue drain BEFORE we add to it. Same pause mechanism
 *       supports manual pause via cmd palette → "Auto-Attribute: pause
 *       for 30 min (work-network mode)" — useful when you walk into the
 *       office and know the work-WiFi will be flaky. Resume early via
 *       "Auto-Attribute: resume now (clear manual pause)".
 *   (c) Parallel BT_attr writes. insertAttrs used to await sequentially:
 *       6 round-trips of stalled UI per TODO. Now Promise.all'd —
 *       wall-clock cost drops from ~6×latency to ~1×latency. Roam owns
 *       its own ordering via the explicit `order: i` we pass; concurrent
 *       creates don't race each other on layout.
 *   New settings: pauseGraceMs (60s), manualPauseDurationMs (30min).
 *   show-stats panel adds a "pause status" section with current effective
 *   state (network online/offline + manual pause expiry + scan interval).
 *
 * v1.8.1 — Page-context project adoption + verified existing dedup.
 *   When a TODO is created on a page that itself has `Project Status:: Active`
 *   (or `Ongoing`), the plugin now adopts that page as BT_attrProject without
 *   calling the LLM. Deterministic user signal: writing a TODO ON a project
 *   page IS the project assignment. Falls through to existing LLM flow only
 *   when the page is not project-tagged (or is `Project Status:: Archive`).
 *   Handles both the literal form (`Project Status:: Active`) and the
 *   Universal Selector dropdown form (`Project Status:: {{or: Active | ...}}`)
 *   — the dropdown was the real-world failure case (page `[[filler idle
 *   validation]]` 2026-05-07: TODO got `[[@1:1/Lori Boyd]]` from LLM instead
 *   of inheriting the page). Excludes daily pages, roam/* pages, the
 *   Active Projects hub, the log page, the settings page, and the
 *   corrections page from the adoption check. New setting
 *   `adopt_active_project_page:: true` (default ON; toggle off to revert
 *   to pure LLM flow). Skips the periodic-scan auto-attribution path too —
 *   if the TODO is on an active page, it's adopted at first sight, not
 *   just on first edit. Side effect: when the page-context path fires,
 *   the LLM call is skipped entirely so priority/energy/context/notes
 *   stay empty until the user fills them or invokes "process focused
 *   TODO now" via cmd palette to do an LLM completion of the rest.
 *
 * v1.7.10 — Default cleanTodoText to false. The LLM stage of the cleanup
 *   was reading user-typed parenthetical content `(...)` and `#tag`s as
 *   "redundant" once BT_attrNotes / BT_attrProject captured the same
 *   information, then silently overwriting the parent block to strip
 *   them. Reproduced 2026-05-02 with B2 backup task on a future daily
 *   page: `{{[[TODO]]}} Set up B2 restic backup for ~/.claude-mem (replace
 *   abandoned git backups) #infrastructure` → `{{[[TODO]]}} Set up B2
 *   restic backup for ~/.claude-mem`. The plugin's own changelog said
 *   "conservative — only cleans when AI is confident the removed phrase
 *   is captured in attributes" but the AI is too aggressive about that
 *   judgment. User toggle (`Auto-Attribute: toggle clean-text`) still
 *   works for opt-in. Settings page schema description updated to warn.
 *   Existing graphs with `clean_todo_text:: true` keep that value (graph
 *   wins over default); flip the block to `false` on the page or via the
 *   cmd palette toggle to inherit the new default.
 *
 * v1.7.9 — Hotfix: v1.7.8 had 3 literal triple-backtick sequences (1 in a
 *   comment, 2 in string literals) that terminated the outer Roam markdown
 *   code fence mid-script — half the source rendered as plain Roam blocks.
 *   Replaced with `\`.repeat(3)` form (same approach as the existing
 *   v1.0.5 fix; that changelog entry already warned about this exact
 *   collision and the rule got broken in v1.7.8). No behavior change.
 *
 * v1.7.8 — Merge: Svyat's parallel v1.7.7 defenses (length cap + code-fence
 *   check inside `isTodo`) joined with this file's structural exclusion
 *   (`isExcludedFromAttribution` page-title filter). Belt-and-suspenders:
 *   `isTodo` rejects fenced code AND blocks > 5000 chars at the cheapest
 *   layer; `isExcludedFromAttribution` rejects entire pages (roam/*,
 *   Chief of Staff/*, contextPages, plugin's own pages) at a structural
 *   layer. Either fix alone covers most cases — together they cover the
 *   classes the other misses (Svyat's caught long fenced plugin sources;
 *   page-filter caught short doc blocks with inline-backtick {{[[TODO]]}}).
 *   Cleanup cmd palette command from v1.7.7 is preserved.
 *
 * v1.7.7 — Bugfix: STOP self-attributing. The plugin's own source code (and
 *   every other roam/js plugin's source) contains the literal string
 *   `{{[[TODO]]}}` in comments and datalog queries — `findAllTodos` and
 *   `isTodo` matched on substring inclusion, so the JS source blocks were
 *   classified as TODOs and decorated with BT_attrDue, BT_attrPriority,
 *   BT_attrProject, BT_attrNotes children. Those children break the plugin
 *   when Roam re-evaluates the block (the `auto-attributed (low conf 0.35)`
 *   comment was the smoking gun: confidence below threshold should never
 *   have been written, but the source was misclassified as a TODO before
 *   confidence was even computed). Three-layer fix:
 *     1. `findAllTodos` datalog now excludes any block whose page title
 *        starts with `roam/` (catches roam/js, roam/css, roam/files, and
 *        every plugin's sub-page like roam/js/auto-attribute-todo).
 *     2. `processBlock` runs `isExcludedFromAttribution(uid, text)` before
 *        `isTodo` — covers the pull-watch and cmd-palette entry points
 *        that bypass `findAllTodos`. Also excludes the plugin's own
 *        SETTINGS_PAGE / LOG_PAGE / corrections page, and any block whose
 *        text starts with a fenced code block (triple-backtick), so plugin source
 *        pasted on a non-roam page (rare but possible) is still skipped.
 *     3. New cmd palette command "cleanup misattributed roam/js blocks
 *        (one-time)" — finds every BT_attr child currently attached to a
 *        block on a roam/* page and deletes them. Reversible via Cmd+Z.
 *   Why the prior 2 fixes didn't stick: they tightened scoring/dedup
 *   downstream. The block was still SCANNED, still reached `processBlock`,
 *   and the LLM still got called. This fix gates the scanner at the
 *   structural level (page membership), not at content heuristics.
 *
 * v1.7.6 — Bugfix: ReferenceError on init. The v1.7.5 settings-page-lib
 *   refactor introduced `createSettingsManager({SETTINGS_PAGE, GRAPH_SETTINGS,
 *   ...})` using object-property-shorthand, but never declared a top-level
 *   `const SETTINGS_PAGE` (auto-attribute-todo had been using
 *   `state.settings.settingsPage` since v1.7.4). Result: ReferenceError on
 *   init, IIFE bailed out, no commands registered, no pull-watch, no scan.
 *   Fix: add `const SETTINGS_PAGE = "Auto-Attribute Settings"` matching the
 *   other 5 plugins' convention. Behavior identical to v1.7.5 once running.
 *
 * v1.7.5 — Refactor: settings-page helpers extracted into _lib/settings-page.js
 *   factory, inlined into each plugin via sync-settings-lib.sh. Single source
 *   of truth for the helpers, deployed bytes still self-contained.
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
  const VERSION = "1.8.11";
  const NAMESPACE = "auto-attr-todo";
  const LOG_PAGE = "Auto-Attribute TODO Log";
  const SETTINGS_PAGE = "Auto-Attribute Settings";

  const DEFAULTS = {
    enabled: true,
    debounceMs: 5000,            // 5 sec — user types thoughts then converts to TODO
    minTextLength: 12,
    confidenceThreshold: 0.6,
    dailyCallCap: 100,
    scanIntervalMs: 30 * 60_000,  // v1.8.3: 60 min → 30 min compromise. v1.8.2 went 15→60 to reduce write pressure, but the actual sync failure mode turned out to be INBOUND apply lag (nautilus reactive reads, retired 2026-05-07), not outbound writes. 30 min keeps the lower-write benefit without delaying new-TODO attribution by up to an hour.
    scanBudgetPerCycle: 10,
    catchupStaggerMs: 250,  // v1.8.8: ms between successive processBlock fires during unbounded catchup. 250 → ~4/sec → 100 items finish in 25s. Periodic scans don't stagger (budget keeps batch small).
    catchupConfirmAbove: 30,  // v1.8.8: if unbounded scan finds > N items, prompt before queuing. Prevents accidental storms (e.g. master-switch flipped on after long off-period). 0 = never prompt.
    enableStartupCatchup: false,  // v1.8.11: off by default. v1.8.4 ran an unbounded scan on every init() to drain off-hours backlog; in practice this re-floods the queue with old un-attributable TODOs every Roam tab open. Use cmd-palette "rescue backlog" to drain on demand.
    maxRetriesPerDay: 3,  // v1.8.11: per-UID retry budget for null/throw failures. After N attempts in a day, UID stays locked in processedToday (permanent same-day skip). Was effectively unbounded — single block ((H-3kgQz8m)) accumulated 31 retries in 16h.
    // v1.8.1 — pause-on-network-pressure: when the browser reports offline,
    // OR the user manually pauses (cmd palette), suppress all LLM calls,
    // scans, and BT_attr writes. Resume after `pauseGraceMs` of being back
    // online (so the existing sync queue has time to drain before we add to it).
    pauseGraceMs: 60_000,         // wait 60s after coming back online before resuming
    manualPauseDurationMs: 30 * 60_000, // 30 min default for manual pause cmd
    contextPages: ["Time Block Constraints", "Chief of Staff/Memory"],
    // v1.8.9: pages whose blocks must NEVER be auto-attributed even if they
    // contain `{{[[TODO]]}}`. Default includes `roam/templates` and
    // `roam/js/smartblocks/workflows` per user request 2026-05-11. Those two
    // are already caught by the `startsWith("roam/")` filter in
    // isExcludedFromAttribution + the datalog query in findAllTodos — listing
    // them by name is belt-and-suspenders + lets non-roam/-prefixed template
    // pages (e.g. user-named "Templates" or "SmartBlocks Workflows") be added
    // via the graph setting `template_pages::`.
    templatePages: ["roam/templates", "roam/js/smartblocks/workflows"],
    requireConfirmation: false,
    aliasKeyword: "Aliases",
    contextPathDepth: 5,
    contextChildren: true,
    contextSiblings: true,
    cleanTodoText: false,        // v1.7.10: default OFF — LLM was stripping user-typed parens content + #tags as "redundant" once BT_attrNotes/Project captured them, mutating titles in non-obvious ways. User toggle still works for opt-in.
    stripRelativeDates: true,    // v1.8.10: deterministic regex strip of trailing relative-date phrases ("this Thursday", "today", "by next week") when BT_attrDue is set. Closed regex set, end-of-string anchored — never touches parens/tags/mid-title text. Safer than cleanTodoText; default ON.
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
    // ── v1.8.0: log housekeeping ────────────────────────────────────────────
    logRetentionDays: 30,         // prune day-grouped or flat log entries older than this
    logGroupByDay: true,          // nest each new entry under [[Month Dth, YYYY]] parent
    logPruneIntervalMs: 24 * 60 * 60_000, // run prune at most once per day per session
    // ── v1.8.0: follow ((uid)) block-refs in TODO title for stronger attribution ─
    followBlockRefs: true,        // resolve ((uid)) refs to surface ref'd text + project hints
    blockRefMaxDepth: 1,          // how deep to follow chained refs (1 = direct only)
    blockRefMaxFollow: 5,         // safety cap on number of refs followed per TODO
  };

  const state = {
    settings: { ...DEFAULTS },
    pending: new Map(),          // uid → debounce timer
    processedToday: new Set(),
    // v1.8.11: uid → fail count for current local day. Bumped on null LLM result
    // or insertAttrs throw. When fails >= settings.maxRetriesPerDay, UID stays
    // in processedToday (no delete) so the periodic scan stops re-trying.
    // Persisted to localStorage alongside processedToday; resets at midnight.
    failedAttemptsToday: new Map(),
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
    // ── v1.8.1 pause state ────────────────────────────────────────────────
    networkOnline: true,          // mirrors navigator.onLine; flipped by online/offline events
    // v1.8.5: was Date.now() — that triggered a 60-second `pauseReason()`
    // "online-grace" window on every script reload, so the v1.8.4 catch-up
    // scan and any pull-watch fires during the first 60s would bail.
    // The grace is meant ONLY for offline→online transitions (give Roam's
    // sync queue time to drain after reconnect) — it shouldn't apply at
    // initial script load, when there's no transition. Initialize to 0;
    // the `online` event handler and the manual-resume cmd palette both
    // set Date.now() explicitly when grace is genuinely warranted.
    networkOnlineSince: 0,
    manualPauseUntil: 0,          // ms timestamp; 0 = no manual pause
    onlineHandler: null,          // bound listener for cleanup
    offlineHandler: null,
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

  // v1.8.11: per-day retry-count cache (uid → fail-count). Same date-keyed
  // shape as loadProcessed; auto-clears at midnight.
  function loadFailedAttempts() {
    const today = new Date().toDateString();
    try {
      const stored = JSON.parse(localStorage.getItem(sk("failedAttempts")) || "{}");
      if (stored.date !== today) return new Map();
      return new Map(stored.entries || []);
    } catch { return new Map(); }
  }

  function persistProcessed() {
    const today = new Date().toDateString();
    localStorage.setItem(sk("processed"), JSON.stringify({
      date: today,
      uids: Array.from(state.processedToday),
    }));
    // v1.8.11: piggyback the retry-counter persist on every processedToday
    // write since the two are mutated together in processBlock.
    localStorage.setItem(sk("failedAttempts"), JSON.stringify({
      date: today,
      entries: Array.from(state.failedAttemptsToday.entries()),
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
    ["clean_todo_text",        "cleanTodoText",          "bool",   false, "Rewrite the TODO title to remove hints captured into BT_attr children. WARNING: the LLM stage interprets '(parens)' content and '#tags' as redundant once BT_attrNotes/Project capture them and silently strips them. Default OFF since v1.7.10. Opt in only if you actively want title cleanup AND keep all critical context outside parens/tags."],
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
    // v1.8.0: log housekeeping
    ["log_retention_days",     "logRetentionDays",       "int",    30,    "Auto-prune Auto-Attribute TODO Log entries older than this many days. Set very high (e.g. 99999) to disable pruning."],
    ["log_group_by_day",       "logGroupByDay",          "bool",   true,  "Nest each new log entry under a [[Month Dth, YYYY]] parent block. Keeps the log page collapsible by day instead of one flat list of hundreds of entries."],
    // v1.8.0: block-ref following
    ["follow_block_refs",      "followBlockRefs",        "bool",   true,  "When a TODO title contains ((uid)) block-refs, fetch the referenced blocks and feed their text + their own BT_attrProject into the LLM as a strong context signal. Catches 'do final pass on ((other-todo))' where the referenced block has the project."],
    ["block_ref_max_follow",   "blockRefMaxFollow",      "int",    5,     "Max number of ((uid)) refs to resolve per TODO. Safety cap."],
    // v1.8.1: page-context project adoption
    ["adopt_active_project_page", "adoptActiveProjectPage", "bool", true, "When the TODO is on a page that itself has 'Project Status:: Active' (or 'Ongoing'), adopt that page as BT_attrProject without calling the LLM. Skips daily pages, roam/* system pages, the hub/log/settings/corrections pages, and pages with Project Status:: Archive. Off = pure LLM flow regardless of page context."],
    // v1.8.9: explicit template-page exclusion
    ["template_pages",         "templatePages",          "csv",    "roam/templates, roam/js/smartblocks/workflows", "Comma-separated page titles whose blocks must never be auto-attributed even if they contain {{[[TODO]]}}. Default includes roam/templates (Roam's built-in template page) and roam/js/smartblocks/workflows. Add custom workflow / template page names here (e.g. 'Templates, SmartBlocks Workflows') if yours live outside the roam/ namespace. The roam/* prefix is already excluded globally — this list adds extra named pages on top."],
    // v1.8.10: deterministic relative-date stripping
    ["strip_relative_dates",   "stripRelativeDates",     "bool",   true,  "Strip trailing relative-date phrases ('this Thursday', 'today', 'by next week') from the TODO title when BT_attrDue captures the absolute date. Closed regex set, end-of-string anchored — won't touch parens, tags, or mid-title text. Safer than the deprecated cleanTodoText feature. Off = leave titles as-is."],
    // v1.8.11: startup-catchup gating + retry budget
    ["enable_startup_catchup", "enableStartupCatchup",   "bool",   false, "Run an unbounded scan on every script init() to drain the off-hours backlog. Default OFF since v1.8.11 — re-floods the queue with weeks-old un-attributable TODOs on every Roam reload. Use cmd-palette 'Auto-Attribute: rescue backlog' to drain manually when you actually want it."],
    ["max_retries_per_day",    "maxRetriesPerDay",       "int",    3,     "Per-UID retry budget. After N null-LLM-result or insertAttrs-throw failures in a day, the UID stays locked in processedToday (permanent same-day skip). Prevents single un-attributable blocks from accumulating dozens of retry log entries. Resets at midnight along with processedToday."],
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
      // v1.8.9: comma-separated list of strings → array. Trims each item, drops
      // empties. Empty input returns []. Used for template_pages and any
      // future multi-string setting that would otherwise need a JSON array.
      if (type === "csv") {
        return s ? s.split(",").map(p => p.trim()).filter(Boolean) : [];
      }
      return s;
    }

    function formatSettingValue(type, value) {
      if (type === "bool") return value ? "true" : "false";
      if (type === "csv") return Array.isArray(value) ? value.join(", ") : String(value);
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

  /* v1.8.0: extract ((uid)) block-refs from text. Returns dedup'd list of
   * 9-char-ish UIDs. Tolerates the (((uid))) typo by matching the inner pair.
   * Filters out ((not-a-real-uid)) noise via the alphanumeric+_- charset. */
  function extractBlockRefUids(text) {
    if (!text || typeof text !== "string") return [];
    const out = new Set();
    // Match ((uid)) — 6+ chars of [A-Za-z0-9_-]. Roam UIDs are 9 chars but
    // older blocks can be shorter; 6 is safe lower bound.
    const re = /\(\(([A-Za-z0-9_-]{6,15})\)\)/g;
    let m;
    while ((m = re.exec(text)) !== null) out.add(m[1]);
    return [...out];
  }

  /* v1.8.0: parse a BT_attrProject:: child block string into a project name.
   * Handles BOTH dropdown ({{or: [[X]] | ...}}) and flat ([[X]]) syntax. */
  function parseBTProjectFromString(s) {
    if (!s) return null;
    const m = s.match(/^BT_attrProject::\s*(?:\{\{or:\s*)?\[\[(.+?)\]\]/);
    return m ? m[1] : null;
  }

  /* v1.8.0: resolve a block-ref UID to the rich context the LLM needs.
   * Returns { uid, text, btProject, pageRefs: Set<string>, breadcrumb: string }
   * or null if the block doesn't exist. Used for both prompt context AND
   * graph-Jaccard ref-set expansion. */
  function resolveReferencedBlock(uid) {
    try {
      const data = window.roamAlphaAPI.data.pull(
        `[:block/string
          :block/uid
          {:block/children [:block/string]}
          {:block/refs [:node/title]}
          {:block/parents [:block/string]}]`,
        [":block/uid", uid]
      );
      if (!data) return null;
      const text = (data[":block/string"] || "").trim();
      if (!text) return null;
      let btProject = null;
      for (const c of (data[":block/children"] || [])) {
        const cs = c[":block/string"] || "";
        if (cs.startsWith("BT_attrProject::")) {
          btProject = parseBTProjectFromString(cs);
          if (btProject) break;
        }
      }
      const pageRefs = new Set();
      for (const r of (data[":block/refs"] || [])) {
        if (r[":node/title"]) pageRefs.add(r[":node/title"]);
      }
      const breadcrumb = (data[":block/parents"] || [])
        .map(p => (p[":block/string"] || "").slice(0, 200))
        .filter(Boolean)
        .join(" > ");
      return { uid, text, btProject, pageRefs, breadcrumb };
    } catch (e) {
      log("debug", `resolveReferencedBlock failed for ${uid}`, e?.message || e);
      return null;
    }
  }

  /* v1.8.0: collect ((uid)) refs from a TODO's text + breadcrumb, capped by
   * blockRefMaxFollow. Returns array of resolved blocks (filters nulls).
   * Used by attribute(), collectTodoContextRefs, buildTodoEmbedText. */
  function collectReferencedBlocks(todoUid, todoText) {
    if (!state.settings.followBlockRefs) return [];
    let candidateUids = extractBlockRefUids(todoText);
    // Also pull ((uid)) refs from the breadcrumb — sometimes the TODO is
    // nested under a block that itself references a project block.
    try {
      const parents = window.roamAlphaAPI.data.pull(
        "[{:block/parents [:block/string]}]",
        [":block/uid", todoUid]
      )?.[":block/parents"] || [];
      for (const p of parents) {
        const refs = extractBlockRefUids(p[":block/string"] || "");
        for (const r of refs) {
          if (!candidateUids.includes(r)) candidateUids.push(r);
        }
      }
    } catch {}
    // Drop the TODO's own UID if it matched (self-ref edge case)
    candidateUids = candidateUids.filter(u => u !== todoUid);
    const cap = state.settings.blockRefMaxFollow || 5;
    return candidateUids
      .slice(0, cap)
      .map(resolveReferencedBlock)
      .filter(Boolean);
  }

  // v1.7.8: cheap defense layers run before the substring match.
  // Fenced-code and >5000-char blocks are never real TODOs; rejecting
  // here saves the page-title pull and any LLM call downstream.
  const isTodo = (s) => {
    if (!s) return false;
    if (s.trimStart().startsWith("`".repeat(3))) return false;
    if (s.length > 5000) return false;
    return s.includes("{{[[TODO]]}}");
  };

  function hasBTProject(blockData) {
    const ch = blockData?.[":block/children"] || [];
    return ch.some((c) => (c[":block/string"] || "").startsWith("BT_attrProject::"));
  }

  /* v1.8.10: deterministic relative-date stripping. Closed regex set —
   * never invokes the LLM, never touches parens/tags/em-dash context
   * (unlike the deprecated `cleanTodoText` feature which over-stripped).
   *
   * Trigger: insertAttrs() calls this AFTER writing BT_attrDue if a
   * relative-date phrase appears at the END of the title. The end-of-
   * string anchor (`\s*$`) is the safety belt — mid-title matches like
   * "Schedule next week's meeting" would risk producing "Schedule 's
   * meeting", but "Build sanitary weekly schedule this Thursday" has the
   * phrase at end and strips cleanly to "Build sanitary weekly schedule".
   *
   * Applied iteratively (capped at 5 passes) so chained tails like
   * "review X today this week" → "review X today" → "review X" work.
   *
   * Failure case that motivated this: Roam block ((kjl82B-Q0)) had
   * BT_attrDue:: [[May 14th, 2026]] inserted but title still read
   * "Build sanitary weekly schedule this Thursday" — redundant + the
   * relative phrase is brittle (will drift wrong meaning next week). */
  const END_RELATIVE_DAY = /\s+\b(this|next|last|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*$/i;
  const END_TODAY_LIKE = /\s+\b(today|tomorrow|yesterday|tonight)\b\s*$/i;
  const END_RELATIVE_WEEK = /\s+\b(this|next|last)\s+(week|month|year|weekend|morning|afternoon|evening|night|quarter)\b\s*$/i;
  const END_BY_DATE = /\s+\b(by|before|after|until|due)\s+(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this\s+(?:week|month|weekend|morning|afternoon|evening|night)|next\s+(?:week|month|weekend|morning|afternoon|evening|night))\b\s*$/i;

  function stripRelativeDatePhrases(text) {
    let cleaned = text;
    const stripped = [];
    for (let pass = 0; pass < 5; pass++) {
      let changed = false;
      for (const re of [END_BY_DATE, END_RELATIVE_DAY, END_RELATIVE_WEEK, END_TODAY_LIKE]) {
        const m = cleaned.match(re);
        if (m) {
          stripped.push(m[0].trim());
          cleaned = cleaned.replace(re, "").trimEnd();
          changed = true;
        }
      }
      if (!changed) break;
    }
    return { cleaned, stripped };
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

  /* v1.7.7 — Source-block immunity. The plugin's own JS source contains
   * `{{[[TODO]]}}` literally (in comments + datalog queries), so the naive
   * substring `isTodo` check used to misclassify the source block as a
   * TODO and write BT_attr children into it — corrupting the plugin. These
   * helpers gate writes by structural facts (page membership, code-fence
   * shape) instead of content heuristics. */

  function getBlockPageTitle(uid) {
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/page [:node/title]}]",
        [":block/uid", uid]
      );
      return data?.[":block/page"]?.[":node/title"] || null;
    } catch {
      return null;
    }
  }

  function looksLikeCodeBlock(s) {
    if (!s) return false;
    return s.trimStart().startsWith("`".repeat(3));
  }

  function isExcludedFromAttribution(uid, text) {
    const pageTitle = getBlockPageTitle(uid);
    if (pageTitle) {
      if (pageTitle.startsWith("roam/")) return `page "${pageTitle}"`;
      if (pageTitle.startsWith("Chief of Staff/")) return `page "${pageTitle}"`;
      if (pageTitle === LOG_PAGE) return `own log page`;
      if (pageTitle === SETTINGS_PAGE) return `own settings page`;
      if (pageTitle === state.settings.correctionsPage) return `corrections page`;
      if (pageTitle === state.settings.activeProjectsHub) return `hub page`;
      // v1.8.9: explicit template-page exclusions. `roam/templates` and
      // `roam/js/smartblocks/workflows` are already caught by the
      // startsWith("roam/") above, but listing them by name documents
      // intent + lets user-extendable templatePages add Templates / SmartBlocks
      // workflow pages that DON'T live under the roam/ namespace (custom
      // setups). Setting key: `template_pages` on [[Auto-Attribute Settings]],
      // comma-separated page titles.
      const templatePages = state.settings.templatePages || [];
      if (templatePages.includes(pageTitle)) return `template page "${pageTitle}"`;
      // contextPages are read for LLM context, never written to. Real bug:
      // Time Block Constraints and Chief of Staff/Memory both got self-
      // attributed because their documentation blocks contain `{{[[TODO]]}}`
      // in inline backticks (which are NOT a fenced code block).
      const contextPages = state.settings.contextPages || [];
      if (contextPages.includes(pageTitle)) return `context page "${pageTitle}"`;
    }
    if (looksLikeCodeBlock(text)) return "fenced code block";
    return null;
  }

  /* v1.8.1: page-context project adoption.
   * Returns the page title if the TODO is on a page whose own
   * `Project Status::` block resolves to Active or Ongoing, null otherwise.
   * Handles both literal `Project Status:: Active` and the Universal
   * Selector dropdown form `Project Status:: {{or: Active | +attr:[[Project Status]]}}`
   * — the dropdown was the failure case discovered 2026-05-07 with page
   * `[[filler idle validation]]`. Excludes daily pages, system pages
   * (roam/*, hub, etc.), and the plugin's own pages from adoption. */
  function findActiveProjectAncestor(uid) {
    const pageTitle = getBlockPageTitle(uid);
    if (!pageTitle) return null;
    if (isDailyPageTitle(pageTitle)) return null;
    if (isSystemPageTitle(pageTitle)) return null;
    if (pageTitle === LOG_PAGE) return null;
    if (pageTitle === SETTINGS_PAGE) return null;
    if (pageTitle === state.settings.correctionsPage) return null;

    const activeStatuses = (state.settings.activeProjectStatuses || ["Active", "Ongoing"])
      .map(s => s.toLowerCase());

    try {
      const safeName = pageTitle.replaceAll('"', '\\"');
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?s
         :where
         [?p :node/title "${safeName}"]
         [?b :block/page ?p]
         [?b :block/string ?s]
         [(clojure.string/starts-with? ?s "Project Status::")]]
      `);
      if (!rows || rows.length === 0) return null;
      for (const row of rows) {
        const s = row[0] || "";
        const m = s.match(/^Project Status::\s*(.+)$/);
        if (!m) continue;
        let value = m[1].trim();
        // Universal Selector dropdown form: {{or: Active | +attr:...}} →
        // grab the FIRST option (currently selected value).
        const dropdown = value.match(/^\{\{or:\s*([^|}]+)/);
        if (dropdown) value = dropdown[1].trim();
        // Strip [[...]] wrap if the status is a page link.
        value = value.replace(/^\[\[(.+)\]\]$/, "$1").trim().toLowerCase();
        if (value === "archive" || value === "archived") return null;
        if (activeStatuses.includes(value)) return pageTitle;
      }
    } catch (e) {
      log("debug", `findActiveProjectAncestor failed for ${pageTitle}`, e);
    }
    return null;
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
      // v1.8.0: expand the ref set with page-refs from any ((uid)) block-refs
      // in the TODO text or breadcrumb. Lets graph-Jaccard pre-rank pick up
      // "TODO references a block belonging to project X".
      const todoText = data?.[":block/string"] || "";
      const referencedBlocks = collectReferencedBlocks(uid, todoText);
      for (const rb of referencedBlocks) {
        for (const t of rb.pageRefs) refs.add(t);
        // If the referenced block has its own BT_attrProject, that project's
        // page name is the strongest possible signal — add it.
        if (rb.btProject) refs.add(rb.btProject);
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
    // v1.8.0: inline referenced block content so semantic embedding "sees"
    // through ((uid)) refs. Without this, the embedder treats ((abc123)) as
    // an opaque token.
    const refBlocks = collectReferencedBlocks(uid, text);
    let refText = "";
    if (refBlocks.length) {
      refText = "\n\nReferenced blocks:\n" + refBlocks
        .map(rb => `- "${rb.text.slice(0, 200)}"${rb.btProject ? ` [project: ${rb.btProject}]` : ""}`)
        .join("\n");
    }
    return (breadcrumb ? `${breadcrumb}\n${text}` : text) + refText;
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

  function findAllTodos({ limit = 25 } = {}) {
    // Returns TODOs sorted newest-first by block edit time. Default limit 25
    // is the periodic-scan throttle (one cycle = one batch). v1.8.6: catchup
    // call sites pass `{limit: Infinity}` to drain the entire backlog — the
    // 25-cap was a silent miss for older un-attributed TODOs when 25+ newer
    // edits buried them (failure case ((ulEJoZC0R)) on May 10).
    //
    // v1.7.7: exclude blocks on roam/* pages at the datalog level — plugin
    // sources literally contain "{{[[TODO]]}}" in comments and would otherwise
    // be picked up and self-attributed.
    try {
      const rows = window.roamAlphaAPI.data.q(`
        [:find ?uid ?edit
         :where
         [?b :block/uid ?uid]
         [?b :block/string ?s]
         [(clojure.string/includes? ?s "{{[[TODO]]}}")]
         [?b :block/page ?p]
         [?p :node/title ?t]
         (not [(clojure.string/starts-with? ?t "roam/")])
         [?b :edit/time ?edit]]
      `);
      rows.sort((a, b) => (b[1] || 0) - (a[1] || 0));
      const sliced = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
      return sliced.map((r) => r[0]);
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
    // v1.8.0: if the TODO references a block whose BT_attrProject points to
    // a project page that isn't in the active list, inject it as a synthetic
    // candidate so the LLM has it as a choice. The picker rule "always return
    // the canonical name from the list" otherwise blocks it. Page must
    // physically exist (we don't fabricate options).
    const refBlocksForProjects = collectReferencedBlocks(uid, text);
    if (refBlocksForProjects.length) {
      const activeNames = new Set(projectsDataRaw.map(p => p.name));
      for (const rb of refBlocksForProjects) {
        if (!rb.btProject) continue;
        if (activeNames.has(rb.btProject)) continue;
        // Confirm the project page exists before adding as a candidate
        const exists = window.roamAlphaAPI.q(
          `[:find ?u . :where [?p :node/title "${rb.btProject.replaceAll('"', '\\"')}"] [?p :block/uid ?u]]`
        );
        if (!exists) continue;
        projectsDataRaw.push({ name: rb.btProject, aliases: [], _viaBlockRef: true });
        activeNames.add(rb.btProject);
        log("info", `injected referenced project [[${rb.btProject}]] as candidate (not in Active list)`);
      }
    }
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
    let projectsData = projectsRanked.slice(0, topK);
    // v1.8.0: ensure any block-ref-injected project is in the top-K window
    // even if its similarity scores are zero — without this, the candidate
    // we just injected can be sliced off below the cap.
    const refInjected = projectsRanked.filter(p => p._viaBlockRef);
    for (const ri of refInjected) {
      if (!projectsData.some(p => p.name === ri.name)) projectsData.push(ri);
    }
    const projectListLines = projectsData.map(p => {
      const parts = [];
      if (typeof p.embedScore === "number" && p.embedScore > 0) {
        parts.push(`semantic: ${p.embedScore.toFixed(2)}`);
      }
      if (p.graphScore > 0) parts.push(`graph: ${p.graphScore.toFixed(2)}`);
      if (p._viaBlockRef) parts.push("via block-ref");
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

    // v1.8.0: surface ((uid)) block-refs found in the TODO. Live AI's
    // roamContext doesn't dereference inline ((uid)) — the LLM otherwise sees
    // only the opaque token. Walking the refs ourselves and injecting the
    // referenced text + their BT_attrProject is the strongest signal we can
    // give the picker: "this TODO IS about that other block".
    const referencedBlocks = collectReferencedBlocks(uid, text);
    let referencedBlocksBlock = "";
    if (referencedBlocks.length) {
      const lines = referencedBlocks.map(rb => {
        const cleanText = rb.text.replace(/\s+/g, " ").slice(0, 220);
        const proj = rb.btProject ? ` → already attributed to project [[${rb.btProject}]]` : "";
        const crumb = rb.breadcrumb ? ` (under: ${rb.breadcrumb.slice(0, 120)})` : "";
        return `- ((${rb.uid})) "${cleanText}"${proj}${crumb}`;
      }).join("\n");
      referencedBlocksBlock = `\n\nREFERENCED BLOCKS (the TODO contains ((uid)) block-refs — these are the STRONGEST context signal: this TODO is explicitly about the referenced work):\n${lines}\n
Rules for using referenced blocks:
- If a referenced block has "already attributed to project [[X]]" AND [[X]] appears in the project candidate list above (with or without "via block-ref" tag), set "project" to [[X]] with high confidence (>= 0.85). The user is doing follow-up work on that same project. Block-ref-injected candidates are NOT lower priority — they were added because the user explicitly linked to a block in that project.
- Inherit relevant entity tags (e.g. people via [[Canonical Name]]) from the referenced block when writing the notes field.
- Pull dates ("today/tomorrow") from the OUTER TODO text, not the referenced block — the referenced block's deadline is its own.
- Use the referenced block's text + breadcrumb to inform notes content even when no project transfer applies.\n`;
    }

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
${entityListLines}${correctionsBlock}${referencedBlocksBlock}`;

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
    // v1.8.1: parallelize via Promise.all instead of sequential await. Each
    // create still hits Roam's data-API queue, but the wall-clock cost
    // drops from ~6×latency to ~1×latency. Roam handles its own ordering
    // via the explicit `order: i` we pass — concurrent writes don't race
    // each other on layout. Net: 5 fewer round-trips of stalled UI when
    // Roam's sync queue is already backed up at work.
    const createdUids = [];
    await Promise.all(blocksToCreate.map(async (str, i) => {
      const newUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.block.create({
        location: { "parent-uid": parentUid, order: i },
        block: { uid: newUid, string: str },
      });
      createdUids.push({ uid: newUid, str });
    }));
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

    // v1.8.10: deterministic relative-date stripping. If BT_attrDue is now on
    // this block (either just-inserted or pre-existing), strip trailing
    // relative-date phrases like "this Thursday" / "today" / "by next week"
    // since the absolute date is captured separately. Closed regex set; runs
    // BEFORE the LLM-based cleanTodoText below so the deterministic pass
    // gets the deterministic win. Opt-out: `strip_relative_dates:: false`
    // on the settings page.
    if (state.settings.stripRelativeDates) {
      const dueWasInserted = blocksToCreate.some(b => b.startsWith("BT_attrDue::"));
      const dueAlreadyExisted = existingKeys.has("BT_attrDue");
      if ((dueWasInserted || dueAlreadyExisted) && originalText) {
        const { cleaned, stripped } = stripRelativeDatePhrases(originalText);
        if (stripped.length && cleaned !== originalText) {
          try {
            await window.roamAlphaAPI.data.block.update({
              block: { uid: parentUid, string: cleaned },
            });
            log("info", `[${parentUid}] stripped relative-date phrase(s) "${stripped.join('", "')}" — BT_attrDue covers it`);
            // Update originalText so the downstream cleanTodoText stage (if
            // enabled) sees the already-stripped version and doesn't try to
            // strip the same phrase again.
            originalText = cleaned;
          } catch (e) {
            log("warn", `[${parentUid}] failed to strip relative-date phrase`, e);
          }
        }
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

  /* ---------- Roam log ----------
   * v1.8.0: entries are now grouped under one parent block per day to keep
   * the log page browsable as it grows. Pruning removes day-parent blocks
   * older than logRetentionDays. Old flat entries are pruned by parsing
   * their leading [[Month Dth, YYYY]] prefix — the migrate-flat command
   * also folds them into the new grouped format.
   */
  function ensureLogPage() {
    let pageUid = window.roamAlphaAPI.q(
      `[:find ?u . :where [?p :node/title "${LOG_PAGE}"] [?p :block/uid ?u]]`
    );
    return pageUid;
  }

  async function ensureLogPageCreated() {
    let pageUid = ensureLogPage();
    if (!pageUid) {
      pageUid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.data.page.create({
        page: { title: LOG_PAGE, uid: pageUid },
      });
    }
    return pageUid;
  }

  /* Find or create today's day-parent block on the log page. Day-parent
   * convention: block string == formatRoamDate(0) (which is "[[Month Dth,
   * YYYY]]"). Returns the day-parent block UID. Walks the page's direct
   * children (NOT transitive descendants — important: nested blocks inside
   * legacy flat entries can also match the date string). */
  async function getOrCreateLogDayParent(pageUid, dayString) {
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid :block/string]}]",
        [":block/uid", pageUid]
      );
      const children = data?.[":block/children"] || [];
      for (const c of children) {
        if ((c[":block/string"] || "") === dayString && c[":block/uid"]) {
          return c[":block/uid"];
        }
      }
    } catch (e) {
      log("debug", "getOrCreateLogDayParent lookup failed", e?.message || e);
    }
    const newUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.data.block.create({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid: newUid, string: dayString },
    });
    return newUid;
  }

  async function logToRoam(uid, attrs, error) {
    try {
      const pageUid = await ensureLogPageCreated();
      const ts = new Date().toISOString().slice(11, 19);
      // ((uid)) block-ref so log entries are CLICKABLE — jump back to the
      // source TODO with one click.
      const projectStr = attrs?.project ? `[[${attrs.project}]]` : "no-project";
      const summary = error
        ? `${ts} FAIL ((${uid})): ${error}`
        : `${ts} OK ((${uid})) → ${projectStr} / ${attrs.priority || "?"} / conf ${(attrs.confidence ?? 0).toFixed(2)}`;
      const dayString = formatRoamDate(0);
      // v1.8.0: group under per-day parent if enabled. Falls back to flat
      // (legacy) format if disabled — entries still pruneable since they
      // start with the date.
      if (state.settings.logGroupByDay) {
        const dayParentUid = await getOrCreateLogDayParent(pageUid, dayString);
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": dayParentUid, order: "last" },
          block: { string: summary },
        });
      } else {
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": pageUid, order: "last" },
          block: { string: `${dayString} ${summary}` },
        });
      }
      // Opportunistic prune — only runs once per session-day.
      maybePruneLog().catch(e => log("debug", "log-prune skipped", e?.message || e));
    } catch (e) {
      log("warn", "log-to-roam failed", e);
    }
  }

  /* Parse "[[Month Dth, YYYY]]" or "Month Dth, YYYY" prefix into a Date.
   * Returns null if not parseable. */
  function parseLogEntryDate(s) {
    if (!s) return null;
    const m = s.match(/^\[\[([A-Za-z]+ \d{1,2})(st|nd|rd|th), (\d{4})\]\]/) ||
              s.match(/^([A-Za-z]+ \d{1,2})(st|nd|rd|th), (\d{4})/);
    if (!m) return null;
    const dateStr = `${m[1]}, ${m[3]}`;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  /* v1.8.0: prune top-level log blocks (day-parents OR legacy flat entries)
   * older than logRetentionDays. Also deletes orphaned non-date children of
   * the log page that have no matching prefix (other than the page header). */
  async function pruneLogPage() {
    const pageUid = ensureLogPage();
    if (!pageUid) return { kept: 0, pruned: 0 };
    const retentionDays = state.settings.logRetentionDays || 30;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - retentionDays);
    let pruned = 0;
    let kept = 0;
    let skippedNonDate = 0;
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid :block/string :block/order]}]",
        [":block/uid", pageUid]
      );
      const children = (data?.[":block/children"] || [])
        .slice()
        .sort((a, b) => (a[":block/order"] || 0) - (b[":block/order"] || 0));
      for (const c of children) {
        const cs = c[":block/string"] || "";
        const cu = c[":block/uid"];
        if (!cu) continue;
        const d = parseLogEntryDate(cs);
        if (!d) {
          skippedNonDate++;
          continue;
        }
        if (d < cutoff) {
          try {
            await window.roamAlphaAPI.data.block.delete({ block: { uid: cu } });
            pruned++;
          } catch (e) {
            log("debug", `prune delete failed ${cu}`, e?.message || e);
          }
        } else {
          kept++;
        }
      }
      log("info", `log prune: ${pruned} pruned, ${kept} kept (>${retentionDays}d), ${skippedNonDate} non-date blocks left alone`);
    } catch (e) {
      log("warn", "pruneLogPage failed", e);
    }
    state.lastLogPruneAt = Date.now();
    return { kept, pruned };
  }

  async function maybePruneLog() {
    const interval = state.settings.logPruneIntervalMs || (24 * 60 * 60_000);
    if (state.lastLogPruneAt && Date.now() - state.lastLogPruneAt < interval) return;
    await pruneLogPage();
  }

  /* v1.8.0: one-shot migration — fold flat top-level log entries into per-day
   * parent groups. Idempotent: re-running collapses any new flat entries
   * without touching already-grouped ones. */
  async function migrateFlatLogToGrouped() {
    const pageUid = ensureLogPage();
    if (!pageUid) return { moved: 0 };
    let moved = 0;
    let alreadyGrouped = 0;
    const dayParentCache = new Map(); // dayString → uid
    try {
      const data = window.roamAlphaAPI.data.pull(
        "[{:block/children [:block/uid :block/string :block/order {:block/children [:db/id]}]}]",
        [":block/uid", pageUid]
      );
      const children = (data?.[":block/children"] || [])
        .slice()
        .sort((a, b) => (a[":block/order"] || 0) - (b[":block/order"] || 0));
      for (const c of children) {
        const cs = c[":block/string"] || "";
        const cu = c[":block/uid"];
        if (!cu) continue;
        // Skip blocks that are themselves day-parents (string is exactly a date)
        const isDayParent = /^\[\[[A-Za-z]+ \d{1,2}(st|nd|rd|th), \d{4}\]\]$/.test(cs);
        if (isDayParent) {
          alreadyGrouped++;
          continue;
        }
        // Skip blocks that already have children (likely day-parents in the
        // older un-bracketed format, or other structured blocks — leave alone).
        if ((c[":block/children"] || []).length > 0) continue;
        // Parse leading date and the rest of the entry
        const m = cs.match(/^(\[\[[A-Za-z]+ \d{1,2}(?:st|nd|rd|th), \d{4}\]\])\s+(.*)$/);
        if (!m) continue; // Not a flat log entry — leave alone
        const dayString = m[1];
        const restString = m[2];
        let dayParentUid = dayParentCache.get(dayString);
        if (!dayParentUid) {
          dayParentUid = await getOrCreateLogDayParent(pageUid, dayString);
          dayParentCache.set(dayString, dayParentUid);
        }
        try {
          // Move the flat block under the day-parent and rewrite its string
          // to drop the now-redundant date prefix.
          await window.roamAlphaAPI.data.block.move({
            location: { "parent-uid": dayParentUid, order: "last" },
            block: { uid: cu },
          });
          await window.roamAlphaAPI.data.block.update({
            block: { uid: cu, string: restString },
          });
          moved++;
        } catch (e) {
          log("debug", `migrate move failed ${cu}`, e?.message || e);
        }
      }
    } catch (e) {
      log("warn", "migrateFlatLogToGrouped failed", e);
    }
    log("info", `log migrate: ${moved} flat entries grouped, ${alreadyGrouped} day-parents already in place`);
    return { moved, alreadyGrouped };
  }

  /* ---------- v1.8.1: pause-on-network-pressure ----------
   * Returns the reason this script should be paused, or null if it should run.
   * Three pause sources:
   *   - browser offline (navigator.onLine === false; tracked via online/offline events)
   *   - browser came back online but we're inside the grace period (let Roam's
   *     own queue drain before we add to it)
   *   - manual pause via cmd palette (state.manualPauseUntil > now)
   * Used by processBlock + startScan to skip work cleanly.
   */
  function pauseReason() {
    if (state.manualPauseUntil > Date.now()) {
      const minsLeft = Math.ceil((state.manualPauseUntil - Date.now()) / 60000);
      return `manually paused (${minsLeft} min remaining)`;
    }
    if (!state.networkOnline) return "browser offline";
    const sinceOnline = Date.now() - state.networkOnlineSince;
    const grace = state.settings.pauseGraceMs || 60_000;
    if (sinceOnline < grace) {
      const secsLeft = Math.ceil((grace - sinceOnline) / 1000);
      return `online-grace (${secsLeft}s remaining — letting Roam's sync queue drain)`;
    }
    return null;
  }

  function setupNetworkListeners() {
    if (state.onlineHandler) return; // already bound
    state.networkOnline = (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean")
      ? navigator.onLine : true;
    state.onlineHandler = () => {
      state.networkOnline = true;
      state.networkOnlineSince = Date.now();
      log("info", `network online — resuming after ${(state.settings.pauseGraceMs || 60_000) / 1000}s grace`);
    };
    state.offlineHandler = () => {
      state.networkOnline = false;
      log("warn", "network offline — pausing LLM calls + scans + writes until reconnect");
    };
    window.addEventListener("online", state.onlineHandler);
    window.addEventListener("offline", state.offlineHandler);
  }

  function teardownNetworkListeners() {
    if (state.onlineHandler) {
      try { window.removeEventListener("online", state.onlineHandler); } catch {}
      state.onlineHandler = null;
    }
    if (state.offlineHandler) {
      try { window.removeEventListener("offline", state.offlineHandler); } catch {}
      state.offlineHandler = null;
    }
  }

  /* ---------- core processor ---------- */
  async function processBlock(uid) {
    state.pending.delete(uid);
    if (state.processedToday.has(uid)) return;
    // v1.8.1: bail early if we're paused (network or manual). The TODO
    // stays out of processedToday so it's retried on the next scan after
    // pause clears.
    const why = pauseReason();
    if (why) {
      log("debug", `[${uid}] skipped — ${why}`);
      return;
    }

    const data = getBlock(uid);
    if (!data) return;
    const text = data[":block/string"] || "";
    // v1.7.7: source-block immunity. Catches every entry point (scan,
    // pull-watch, manual cmd palette) before the LLM is called.
    const exclusionReason = isExcludedFromAttribution(uid, text);
    if (exclusionReason) {
      log("debug", `[${uid}] skipped attribution: ${exclusionReason}`);
      return;
    }
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

    // v1.8.1: page-context project adoption — short-circuit BEFORE LLM call.
    // If the TODO is on a page whose own Project Status:: is Active/Ongoing,
    // adopt that page directly and skip the LLM. Deterministic user signal:
    // writing a TODO on a project page IS the project assignment.
    if (state.settings.adoptActiveProjectPage) {
      const pageProject = findActiveProjectAncestor(uid);
      if (pageProject) {
        log("info", `[${uid}] page-context adoption → [[${pageProject}]] (no LLM call)`);
        const adoptedAttrs = {
          project: pageProject,
          top_3_projects: [pageProject],
          confidence: 1.0,
          notes: "page-context adopted",
          source: "page-context",
        };
        try {
          await insertAttrs(uid, adoptedAttrs, text);
          await logToRoam(uid, adoptedAttrs, null);
          if (state.failedAttemptsToday.has(uid)) {
            state.failedAttemptsToday.delete(uid);
            persistProcessed();
          }
        } catch (e) {
          log("error", `[${uid}] page-context insert failed`, e);
          // v1.8.11: bounded retry — same logic as the main LLM path.
          const fails = (state.failedAttemptsToday.get(uid) || 0) + 1;
          state.failedAttemptsToday.set(uid, fails);
          const cap = state.settings.maxRetriesPerDay || 3;
          await logToRoam(uid, adoptedAttrs, `${e.message} (attempt ${fails}/${cap})`);
          if (fails >= cap) {
            log("warn", `[${uid}] page-context insert reached maxRetriesPerDay (${fails}) — locking out for the rest of today.`);
            persistProcessed();
            return;
          }
          state.processedToday.delete(uid);
          persistProcessed();
        }
        return;
      }
    }

    const attrs = await attribute(uid, text);
    if (!attrs) {
      // v1.8.11: per-UID retry budget. v1.8.7's blanket "delete from
      // processedToday on null" treats every null as transient — but some
      // TODOs are legitimately unattributable (meta-tasks, image-only
      // children that make LiveAI return unparseable output, etc.) and would
      // otherwise generate one log entry per scan interval indefinitely
      // (Roam block ((H-3kgQz8m)) hit 31 fails in 16h before this fix).
      // Bump the counter, log it, and only delete from processedToday if
      // we haven't yet hit the budget.
      const fails = (state.failedAttemptsToday.get(uid) || 0) + 1;
      state.failedAttemptsToday.set(uid, fails);
      const cap = state.settings.maxRetriesPerDay || 3;
      await logToRoam(uid, null, `no result (attempt ${fails}/${cap})`);
      if (fails >= cap) {
        log("warn", `[${uid}] reached maxRetriesPerDay (${fails}) — locking out for the rest of today. Use cmd-palette "clear processedToday cache" or "rescue backlog" to retry sooner.`);
        // Keep in processedToday — no delete. Persist the fail count.
        persistProcessed();
        return;
      }
      state.processedToday.delete(uid);
      persistProcessed();
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
      // v1.8.11: success — drop any accumulated fail count so a re-edit later
      // gets full retry budget again.
      if (state.failedAttemptsToday.has(uid)) {
        state.failedAttemptsToday.delete(uid);
        persistProcessed();
      }
    } catch (e) {
      log("error", `insert failed (${uid})`, e);
      // v1.8.11: same retry-budget logic as null-result path. Roam sync errors
      // are usually transient (network blip, write race) but can be recurrent
      // if the block has structural issues — bound the retries.
      const fails = (state.failedAttemptsToday.get(uid) || 0) + 1;
      state.failedAttemptsToday.set(uid, fails);
      const cap = state.settings.maxRetriesPerDay || 3;
      await logToRoam(uid, attrs, `${e.message} (attempt ${fails}/${cap})`);
      if (fails >= cap) {
        log("warn", `[${uid}] insertAttrs reached maxRetriesPerDay (${fails}) — locking out for the rest of today.`);
        persistProcessed();
        return;
      }
      state.processedToday.delete(uid);
      persistProcessed();
    }
  }

  // v1.8.8: optional extraDelayMs lets the catchup + manual scans stagger
  // queued processBlock calls so they don't all fire simultaneously and
  // saturate Roam's sync queue. Live pull-watch fires keep extraDelayMs=0
  // (single-block latency stays low). Catchup with N items passes
  // n * staggerMs so item-100 fires ~20s after item-1 instead of 0s.
  function schedule(uid, extraDelayMs = 0) {
    if (state.pending.has(uid)) clearTimeout(state.pending.get(uid));
    const timer = setTimeout(() => processBlock(uid), state.settings.debounceMs + extraDelayMs);
    state.pending.set(uid, timer);
  }

  /* ---------- watchers ---------- */
  /* v1.8.4: scan-loop body extracted so init() can also call it once on
   * startup with `unbounded: true` to drain the off-hours backlog (item 8a
   * from `((96K0Ncq3l))`). When auto-attribute-todo isn't loaded — Roam tab
   * closed, or the script disabled — TODOs written via the Alpha API
   * (deep-dream LaunchAgent, scheduled scripts, etc.) accumulate without
   * BT_attr children. The first time the script comes online for the day
   * we want to drain that whole backlog at once, not one budget-cap per
   * 60-min cycle. `unbounded: true` skips the budget check; the periodic
   * timer keeps `unbounded: false` so live runtime stays bounded. */
  function runScanCycle({ unbounded = false, label = "scan" } = {}) {
    if (!state.settings.enabled) return 0;
    const why = pauseReason();
    if (why) {
      log("debug", `${label} cycle skipped — ${why}`);
      return 0;
    }
    // v1.8.6: unbounded catchup gets the FULL todo list, not just the top 25.
    // Periodic scan stays capped — pull-watch + 30-min throttle handle live
    // attribution; the catchup is what rescues anything they both missed.
    const uids = findAllTodos({ limit: unbounded ? Infinity : 25 });
    // v1.8.8: pre-count actual backlog (after filtering out already-processed
    // + already-has-BT_attrProject). When > catchupConfirmAbove and unbounded,
    // prompt the user before queuing — prevents accidental storms when
    // master-switch-after-long-off-period unleashes hundreds of items.
    if (unbounded && state.settings.catchupConfirmAbove > 0) {
      let backlog = 0;
      for (const uid of uids) {
        if (state.processedToday.has(uid)) continue;
        if (state.pending.has(uid)) continue;
        const d = getBlock(uid);
        if (!d) continue;
        if (hasBTProject(d)) continue;
        if ((d[":block/string"] || "").length < state.settings.minTextLength) continue;
        backlog++;
      }
      if (backlog > state.settings.catchupConfirmAbove) {
        const staggerSec = Math.ceil((backlog * (state.settings.catchupStaggerMs || 250)) / 1000);
        const proceed = window.confirm(
          `Auto-Attribute ${label}: ${backlog} unattributed TODOs found.\n\n` +
          `This will fire ${backlog} LLM calls (~${(backlog * 0.005).toFixed(2)}-${(backlog * 0.02).toFixed(2)} USD on LiveAI's tier) and write ${backlog} sets of BT_attr children, spread over ~${staggerSec}s.\n\n` +
          `OK to proceed, Cancel to skip. (If unsure, click Cancel — you can run "Auto-Attribute: rescue backlog" later from the cmd palette.)`
        );
        if (!proceed) {
          log("info", `${label} cancelled by user — ${backlog} items deferred`);
          return 0;
        }
      }
    }
    let queued = 0;
    const budget = state.settings.scanBudgetPerCycle;
    // v1.8.8: stagger unbounded queues so they don't all fire simultaneously.
    // Failure case: master switch was OFF for weeks, then flipped ON — catchup
    // queued ~hundreds of TODOs which all hit `processBlock` after the same
    // debounceMs (5s default). Hundreds of parallel LLM calls + BT_attr writes
    // → Roam sync queue saturated → graph hangs. Stagger spreads them: item-0
    // at debounceMs, item-100 at debounceMs + 100*staggerMs = 25s. Periodic
    // scan stays no-stagger (budget keeps batch size sane on its own).
    const staggerMs = unbounded ? (state.settings.catchupStaggerMs || 250) : 0;
    for (const uid of uids) {
      if (!unbounded && queued >= budget) break;
      if (state.processedToday.has(uid)) continue;
      if (state.pending.has(uid)) continue;
      const data = getBlock(uid);
      if (!data) continue;
      if (hasBTProject(data)) {
        state.processedToday.add(uid);
        continue;
      }
      if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
      schedule(uid, queued * staggerMs);
      queued++;
    }
    if (queued > 0) {
      const cap = unbounded ? "no cap" : `${budget}`;
      const spread = staggerMs ? `, spread over ${Math.ceil((queued * staggerMs) / 1000)}s` : "";
      log("info", `${label} queued ${queued} (cap: ${cap}${spread})`);
    }
    return queued;
  }

  function startScan() {
    state.scanTimer = setInterval(() => {
      if (!state.settings.enabled) return;
      // v1.8.1: skip the entire scan cycle while paused. The setting-reload,
      // hub-sync, log-prune, and embedding-refresh all WRITE to Roam — they
      // were a bigger contributor to work-network sync pressure than the
      // attribution itself when the queue was already saturated.
      if (pauseReason()) return;  // runScanCycle also checks; this short-circuits the writes below
      if (state.settings.syncHubOnScan) {
        syncActiveProjectsHub().catch(e => log("warn", "hub sync failed", e));
      }
      // v1.7.4: pick up any setting the user changed inline on the settings page
      loadAllSettingsFromGraph();
      // Phase 3: refresh stale embeddings + GC removed projects every cycle
      refreshEmbeddingsIfStale().catch(e => log("warn", "embed refresh failed", e?.message || e));
      // v1.8.0: prune log page once per day per session
      maybePruneLog().catch(e => log("debug", "scan-prune skipped", e?.message || e));
      runScanCycle({ unbounded: false, label: "scan" });
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
      const uid = f["block-uid"];
      // v1.7.7: surface a clear refusal if user manually targets a system block.
      const data = getBlock(uid);
      const text = data?.[":block/string"] || "";
      const exclusionReason = isExcludedFromAttribution(uid, text);
      if (exclusionReason) {
        const msg = `Refusing to attribute focused block: ${exclusionReason}. Plugin sources and system pages are off-limits.`;
        log("warn", msg);
        try { alert(msg); } catch {}
        return;
      }
      state.processedToday.delete(uid); // allow re-process
      await processBlock(uid);
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
      // v1.7.7: exclude roam/* pages so we don't recurse into misattributed
      // plugin sources (use the dedicated cleanup cmd for those).
      try {
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?uid
           :where
           [?b :block/uid ?uid]
           [?b :block/string ?s]
           [(clojure.string/includes? ?s "{{[[TODO]]}}")]
           [?b :block/page ?p]
           [?p :node/title ?t]
           (not [(clojure.string/starts-with? ?t "roam/")])]
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
    add("Auto-Attribute: cleanup misattributed roam/js blocks (one-time)", async () => {
      // v1.7.7: deletes BT_attr children that the pre-fix scanner attached to
      // blocks on pages that should never have been candidates: roam/*,
      // Chief of Staff/*, plugin's own pages, and configured contextPages.
      // Safe to run repeatedly. Reversible via Cmd+Z.
      try {
        const ctxPages = state.settings.contextPages || [];
        const ctxClause = ctxPages
          .map(p => `[(= ?pageTitle "${p.replaceAll('"', '\\"')}")]`)
          .join(" ");
        const orClauses = [
          `[(clojure.string/starts-with? ?pageTitle "roam/")]`,
          `[(clojure.string/starts-with? ?pageTitle "Chief of Staff/")]`,
          `[(= ?pageTitle "${LOG_PAGE.replaceAll('"', '\\"')}")]`,
          `[(= ?pageTitle "${SETTINGS_PAGE.replaceAll('"', '\\"')}")]`,
          `[(= ?pageTitle "${(state.settings.correctionsPage || "").replaceAll('"', '\\"')}")]`,
          `[(= ?pageTitle "${(state.settings.activeProjectsHub || "").replaceAll('"', '\\"')}")]`,
          ctxClause,
        ].filter(Boolean).join(" ");
        const rows = window.roamAlphaAPI.data.q(`
          [:find ?parentUid ?childUid ?childStr ?pageTitle
           :where
           [?b :block/uid ?parentUid]
           [?b :block/page ?p]
           [?p :node/title ?pageTitle]
           (or ${orClauses})
           [?b :block/children ?c]
           [?c :block/uid ?childUid]
           [?c :block/string ?childStr]
           [(clojure.string/starts-with? ?childStr "BT_attr")]]
        `);
        if (rows.length === 0) {
          const msg = "No BT_attr children found on any roam/* page. Nothing to clean.";
          log("info", msg);
          try { alert(msg); } catch {}
          return;
        }
        const byParent = new Map();
        const byPage = new Map();
        for (const [pUid, cUid, cStr, pTitle] of rows) {
          if (!byParent.has(pUid)) byParent.set(pUid, []);
          byParent.get(pUid).push({ uid: cUid, str: cStr });
          byPage.set(pUid, pTitle);
        }
        const lines = [
          `Found ${rows.length} BT_attr children on ${byParent.size} block(s) across ${new Set(byPage.values()).size} roam/* page(s):`,
          ...Array.from(byParent.entries()).map(([pUid, kids]) =>
            `  • [[${byPage.get(pUid)}]] ((${pUid})) — ${kids.length} child(ren)`
          ),
          ``,
          `Delete all of them? (Cmd+Z reverses individual deletes.)`,
        ];
        if (!confirm(lines.join("\n"))) return;
        let deleted = 0, failed = 0;
        for (const [, kids] of byParent) {
          for (const child of kids) {
            try {
              await window.roamAlphaAPI.data.block.delete({ block: { uid: child.uid } });
              deleted++;
            } catch (e) {
              failed++;
              log("warn", `delete ${child.uid} failed`, e?.message || e);
            }
          }
        }
        const result = `Deleted ${deleted}/${rows.length} BT_attr children. ${failed ? failed + ' failed.' : ''} Refresh Roam to verify.`;
        log("info", result);
        try { alert(result); } catch {}
      } catch (e) {
        log("error", "cleanup misattributed failed", e);
        try { alert("Cleanup failed: " + e.message); } catch {}
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
        `  ${onOff(state.settings.logGroupByDay)} group log entries by day`,
        `  ${onOff(state.settings.followBlockRefs)} follow ((uid)) block-refs in TODOs`,
        ``,
        `── pause status (v1.8.1) ──`,
        `  Network: ${state.networkOnline ? "ONLINE" : "OFFLINE"}`,
        `  Manual pause: ${state.manualPauseUntil > Date.now() ? `until ${new Date(state.manualPauseUntil).toLocaleTimeString()}` : "off"}`,
        `  Effective: ${pauseReason() || "running normally"}`,
        `  Scan interval: ${(state.settings.scanIntervalMs / 60_000).toFixed(0)} min`,
        ``,
        `── log housekeeping ──`,
        `  Retention: ${state.settings.logRetentionDays} days`,
        `  Last prune: ${state.lastLogPruneAt ? new Date(state.lastLogPruneAt).toISOString().slice(0,16).replace("T"," ") : "never (this session)"}`,
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
      // v1.8.6: manual scan is user-explicit "do everything" — drop the
      // 25-cap and the per-cycle budget. The user invoked this because the
      // automatic path missed something; throttling here would defeat that.
      const uids = findAllTodos({ limit: Infinity });
      let queued = 0;
      for (const uid of uids) {
        if (state.processedToday.has(uid) || state.pending.has(uid)) continue;
        const data = getBlock(uid);
        if (!data || hasBTProject(data)) continue;
        if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
        schedule(uid); queued++;
      }
      log("info", `manual scan queued ${queued} blocks (no cap)`);
    });
    add("Auto-Attribute: prune log page now (delete old entries)", async () => {
      // Force run regardless of session-day cooldown
      state.lastLogPruneAt = 0;
      const result = await pruneLogPage();
      try {
        alert(`Auto-Attribute log prune complete\n\nPruned: ${result.pruned}\nKept: ${result.kept}\nRetention: ${state.settings.logRetentionDays} days`);
      } catch {}
    });
    add("Auto-Attribute: migrate flat log entries to per-day groups (one-shot)", async () => {
      const result = await migrateFlatLogToGrouped();
      try {
        alert(`Auto-Attribute log migrate complete\n\nMoved into day groups: ${result.moved}\nDay-parents already in place: ${result.alreadyGrouped}`);
      } catch {}
    });
    add("Auto-Attribute: toggle log grouping by day", toggleSetting("log_group_by_day", "logGroupByDay", "logGroupByDay"));
    add("Auto-Attribute: toggle follow ((uid)) block-refs in TODOs", toggleSetting("follow_block_refs", "followBlockRefs", "followBlockRefs"));
    add("Auto-Attribute: emergency stop (cleanup + disable)", () => {
      state.settings.enabled = false;
      try { cleanup(); } catch (e) { log("warn", "cleanup err", e); }
      log("info", "EMERGENCY STOP — disabled, scan + pullwatch killed for this tab. Refresh page to restart.");
    });
    add("Auto-Attribute: pause for 30 min (work-network mode)", () => {
      const dur = state.settings.manualPauseDurationMs || 30 * 60_000;
      state.manualPauseUntil = Date.now() + dur;
      const until = new Date(state.manualPauseUntil).toLocaleTimeString();
      log("info", `paused until ${until} — no LLM calls, scans, or BT_attr writes`);
      try { alert(`Auto-Attribute paused until ${until}.\n\nDuring pause: scans skip, queued debounce timers do not fire, no LLM calls, no BT_attr writes. Pull-watch still records new TODOs but they queue for after pause.\n\nResume early via "Auto-Attribute: resume now".`); } catch {}
    });
    add("Auto-Attribute: resume now (clear manual pause)", () => {
      const wasPaused = state.manualPauseUntil > Date.now();
      state.manualPauseUntil = 0;
      // Treat resume as if just-came-online so the grace period applies — gives
      // Roam's queue a moment before we add fresh attribution writes.
      state.networkOnlineSince = Date.now();
      log("info", wasPaused ? "manual pause cleared — resuming after grace period" : "(was not paused; nothing to resume)");
    });
    add("Auto-Attribute: clear processedToday cache (allow re-process)", () => {
      state.processedToday = new Set();
      // v1.8.11: also drop retry counters so a manual clear gives every UID
      // its full retry budget back, not just lifts the processedToday lock.
      state.failedAttemptsToday = new Map();
      persistProcessed();
      log("info", "processedToday + retry counts cleared — next scan will re-evaluate everything (within budget)");
    });
    // v1.8.11: surface which UIDs are accumulating null-result failures so a
    // user can investigate (image children? meta-tasks? prompt-too-long?) before
    // they hit maxRetriesPerDay and lock out for the rest of the day.
    add("Auto-Attribute: show retry counts (debug)", () => {
      const cap = state.settings.maxRetriesPerDay || 3;
      const rows = Array.from(state.failedAttemptsToday.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([uid, fails]) => ({
          uid,
          fails,
          locked_out: fails >= cap ? "yes" : "no",
          preview: (getBlock(uid)?.[":block/string"] || "").slice(0, 80),
        }));
      if (!rows.length) {
        log("info", "no retry counts today");
        return;
      }
      log("info", `retry counts (cap = ${cap}/day):`);
      console.table(rows);
    });
    // v1.8.7: one-button rescue. Combines "clear processedToday" + "scan now"
    // with unbounded findAllTodos. Use when an old TODO won't attribute and
    // you don't know whether it's stuck in processedToday or fell out of the
    // top-25 edit-time window. Equivalent to: clear cache, then scan no-cap.
    add("Auto-Attribute: rescue backlog (force-process all unattributed)", () => {
      const uids = findAllTodos({ limit: Infinity });
      // v1.8.8: pre-count + confirm before clearing processedToday + queuing.
      // The May 10 incident: enabling master switch after long off-period
      // unleashed all backlog simultaneously and saturated Roam's sync queue.
      const eligible = [];
      for (const uid of uids) {
        const data = getBlock(uid);
        if (!data || hasBTProject(data)) continue;
        if ((data[":block/string"] || "").length < state.settings.minTextLength) continue;
        if (isExcludedFromAttribution(uid, data[":block/string"] || "")) continue;
        eligible.push(uid);
      }
      const staggerMs = state.settings.catchupStaggerMs || 250;
      const totalSec = Math.ceil((eligible.length * staggerMs) / 1000);
      const proceed = eligible.length === 0 || window.confirm(
        `Auto-Attribute rescue: ${eligible.length} unattributed TODOs found.\n\n` +
        `Will fire ${eligible.length} LLM calls (~${(eligible.length * 0.005).toFixed(2)}-${(eligible.length * 0.02).toFixed(2)} USD on LiveAI tier) and write ${eligible.length} sets of BT_attr children, staggered ${staggerMs}ms apart (~${totalSec}s total).\n\n` +
        `OK to proceed, Cancel to abort. processedToday cache will be cleared either way.`
      );
      state.processedToday = new Set();
      // v1.8.11: also clear retry counts so locked-out UIDs get full budget.
      state.failedAttemptsToday = new Map();
      persistProcessed();
      if (!proceed) {
        log("info", `rescue cancelled — processedToday + retry counts cleared but no items queued`);
        return;
      }
      let queued = 0;
      for (const uid of eligible) {
        schedule(uid, queued * staggerMs);
        queued++;
      }
      const msg = `rescue queued ${queued} unattributed TODOs over ~${totalSec}s`;
      log("info", msg);
      try { alert(msg); } catch {}
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
    state.failedAttemptsToday = loadFailedAttempts();  // v1.8.11
    loadPersistentSettings();  // Phase 3: rehydrate from localStorage cache
    // v1.7.4: bootstrap [[Auto-Attribute Settings]] page (creates missing
    // setting blocks idempotently) then load values from graph. Graph wins
    // over localStorage if they disagree — page is source of truth.
    ensureSettingsPage(false)
      .then(() => loadAllSettingsFromGraph())
      // v1.8.4 (item 8a): drain the off-hours backlog once on init. TODOs
      // written via the Alpha API while the Roam tab was closed (e.g.
      // deep-dream's 03:00 LaunchAgent) wouldn't be touched until the
      // first scheduled scan cycle fires — and even then `scanBudgetPerCycle`
      // would dribble them out one cap per cycle. `unbounded: true` queues
      // the whole backlog at once; the per-block scheduler is still rate-
      // limited downstream by the LLM dispatcher and pause-on-network logic.
      //
      // v1.8.11: now opt-in. User complaint ((H-3kgQz8m)) — startup-catchup
      // floods the dailyCallCap with weeks-old un-attributable TODOs every
      // time Roam reloads. Use cmd-palette "rescue backlog" for manual drain.
      .then(() => {
        if (state.settings.enableStartupCatchup) {
          return runScanCycle({ unbounded: true, label: "startup-catchup" });
        }
        log("info", "startup-catchup disabled (v1.8.11 default). Use cmd-palette 'Auto-Attribute: rescue backlog' to drain backlog on demand.");
      })
      .catch(e => log("warn", "settings page bootstrap or catchup failed", e?.message || e));
    registerCommands();
    setupNetworkListeners();  // v1.8.1: pause on offline, resume after grace
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
    teardownNetworkListeners();  // v1.8.1
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
