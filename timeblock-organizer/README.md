# timeblock-organizer

Watches daily pages and reorganizes time-prefixed TODOs into the `#TimeBlock` Nautilus parent block — sorted by start-time, with the SmartBlock timestamp button pinned as the last child.

Fixes a class of bugs in **any** scheduling tool (Chief of Staff, Better Tasks dropdowns, manual edits, future skills) by observing block-tree changes and correcting state. Zero coupling to any specific writer; no LLM call; cost: $0.

---

## The bug it solves

Svy's daily pages follow this structure:

```
[[April 28th, 2026]]
  - #TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs)) 28 15 6 #important}}
    - 09:00 - 10:00 {{[[TODO]]}} EMP review
    - 11:00 - 12:00 {{[[TODO]]}} swab walk
    - 14:00 - 15:00 {{[[TODO]]}} R analysis
    - {{🕗↦:SmartBlock:Double timestamp buttons2}}    ← always last
```

When Chief of Staff (or any tool) calls `roam_create_todo` with a time prefix like `14:30 - 15:30 {{[[TODO]]}} foo`, it dumps the block as a direct page-level child — **not** under TimeBlock, **not** in time-sort order, and the SmartBlock button can end up above the new task.

This plugin watches and corrects:
- Pulls page-level time-prefixed TODOs into the TimeBlock parent
- Sorts all time-prefixed children of TimeBlock by start time
- Pins the SmartBlock button as the last child every time

---

## Install

1. Paste contents of `script.js` into a `{{[[roam/js]]}}` block in Roam, save, reload.
2. Plugin auto-creates `[[TimeBlock Organizer Settings]]` on first run.
3. By default it starts watching today + tomorrow's daily pages immediately. Reconciles fire ~8s after any block-tree change to coalesce burst writes.

To install via Update Roam JS suite manager: cmd palette → **"Update Roam JS: install timeblock-organizer"**.

Re-pasting the script auto-cleans the previous version's timers and watches via `init()` — same robustness pattern as the rest of the suite.

---

## How it works

**Three lifecycles**:

1. **Pull-watches**: `addPullWatch` on `[:block/children]` of today + tomorrow's daily page UIDs. Fires when COS / Better Tasks / you add or remove children. Lazy-registers when you navigate to a historical daily page within `historical_window_days` (default 7). LRU-capped at `max_active_watches` (default 14).
2. **Date rollover**: every `rollover_check_ms` (default 60s), checks if today's UID changed. Re-registers the watch on the new today + tomorrow.
3. **Periodic sweep**: every `sweep_interval_ms` (default 5min), reconciles all watched pages unconditionally. Catches `block.update` text edits that pull-watch on `:block/children` doesn't fire for (e.g. you edit an existing TODO to add a time prefix).

**The reconcile algorithm** (`reconcileTimeBlock(pageUid)`):

1. Find the TimeBlock parent by prefix-matching `timeblock_signature` against direct page children. If no TimeBlock parent, exit early.
2. Collect:
   - Direct page children that ARE time-prefixed (`HH:MM - HH:MM {{[[TODO/DONE]]}}`) — these are misplaced
   - Direct TimeBlock children that ARE time-prefixed — sort candidates
   - Direct TimeBlock children matching `smartblock_button_signature` — pin to last
   - Other direct TimeBlock children — keep in their existing order, untouched
3. Compute desired sequence: `[non-time-prefixed-tb-children-as-is, ..., time-sorted-todos, ..., smartblock-buttons]`.
4. Compare against current TimeBlock children + page-level misplaced. If equal, no-op (idempotent).
5. Else: set `suppressUntil = now + 2s`, then for each item in desired order, `block.move` to TimeBlock at `order: "last"`. Each move appends to end, so they end up in the desired sequence.

**Self-trigger suppression**: our own `block.move` calls fire the pull-watch. The 2-second suppression window prevents an infinite reconcile loop.

---

## Settings page

`[[TimeBlock Organizer Settings]]` — every toggle is a `key:: value` block, edit inline.

| Block | Default | What it controls |
|---|---|---|
| `enabled:: true` | true | Master switch. false = dormant (no watches, no reconciles). |
| `debounce_ms:: 8000` | 8000 | ms to wait after a daily-page change before reconciling. Coalesces burst writes. |
| `historical_window_days:: 7` | 7 | How far back to auto-register watches when you navigate to historical daily pages. 0 = today+tomorrow only. |
| `max_active_watches:: 14` | 14 | Cap on simultaneously-watched daily pages. LRU evicts when exceeded. |
| `timeblock_signature:: ...` | `#TimeBlock {{[[roam/render]]:((roam-render-Nautilus-cljs))` | Prefix to identify the TimeBlock parent block on a daily page. |
| `smartblock_button_signature:: ...` | `{{🕗↦:SmartBlock:Double timestamp buttons2}}` | Exact string of the SmartBlock timestamp-button to pin as last child. Edit if you renamed it. |
| `sweep_interval_ms:: 300000` | 5 min | Periodic reconcile over all watched pages — catches text-only edits. |
| `rollover_check_ms:: 60000` | 60s | How often to check for date rollover. |
| `suppress_ms:: 2000` | 2000 | Ignore watch callbacks for this long after our own writes (loop prevention). |
| `dry_run:: false` | false | Log every move that WOULD be executed, without actually moving blocks. |
| `verbose:: false` | false | Verbose console logging. Off by default. |

Cmd palette → **"TimeBlock Organizer: open settings page (edit toggles inline)"** to open in the right sidebar.

---

## Cmd palette commands

### Setup / settings
- **open settings page (edit toggles inline)** — opens `[[TimeBlock Organizer Settings]]`
- **reload settings from graph** — re-read every `key:: value` block
- **show stats (current settings)** — alert + console with ON/OFF panel + active-watch count + cached today UID

### Toggles
- **toggle enabled (master switch)** — on/off
- **toggle dry-run mode** — preview without writing
- **toggle verbose logging** — on/off

### Operations
- **reconcile current page now** — forces an immediate reconcile of the open daily page (skip debounce)
- **reconcile today + tomorrow** — runs reconciles on both, useful after pasting a fresh script
- **list active watches (debug)** — table of watched page UIDs with timestamps

---

## What it doesn't do (yet)

**Phase 2** (deferred): conflict detection. When two TODOs overlap (e.g. 14:00-15:00 and 14:30-15:30), the plugin currently just sorts them by start-time. A future version will write a `**TimeBlock Conflicts**` status block under the daily page listing each overlapping pair.

**Phase 3** (deferred, opt-in): smart re-shuffle. When a conflict is detected, automatically bump the later item's start to the earlier item's end, cascading forward up to a configurable cutoff time. Disabled by default — the user might WANT overlapping items.

See `~/roam-js-extensions/SETTINGS-PAGE-ROLLOUT.md` for context on the suite-wide patterns this plugin follows.

---

## Architecture notes

| Choice | Why |
|---|---|
| Companion plugin, not a fork of COS | mlava/chief-of-staff is 34k LOC. Maintaining a fork against upstream is infeasible. Pull-watch on the data layer fixes EVERY writer simultaneously, not just COS. |
| `:block/children` watch on daily-page UIDs | Catches add/remove of direct children. Doesn't catch text-only edits — covered by the periodic sweep. |
| Move every item to `order: "last"` in target sequence | Simpler than computing minimal-diff moves. Roam's move API is fast; even reordering 20 items finishes in &lt;100ms. Idempotent guard skips when already organized. |
| LRU-capped watch set | Each pull-watch is cheap but not free. 14 simultaneous watches is plenty for a typical Roam workflow. |
| Settings via inline graph blocks | Same pattern as auto-attribute-todo, triage-ptn, etc. — graph is source of truth, localStorage is fast-init cache. |

---

## Version history

- **v1.0.0** — Phase 1 ship: pull-watches + reconcile + settings page + idempotent commands + auto-cleanup on init. Fixes COS scheduling bug and handles any other writer.
