# auto-attribute-todo

A Roam Research `roam/js` extension that watches every new `{{[[TODO]]}}` block and auto-fills the Better Tasks attributes (`BT_attrProject`, `BT_attrDue`, `BT_attrPriority`, `BT_attrEnergy`, `BT_attrContext`, `BT_attrNotes`) within ~5 seconds via an LLM call.

Three classification stages compound on each TODO:

1. **Graph-Jaccard** — collects `[[Page]]` refs from the TODO's block + breadcrumb, computes Jaccard similarity against each active project's page refs. Catches "this TODO references the same pages as Project X" without needing the LLM.
2. **Semantic embeddings** *(opt-in, Phase 3)* — embeds the TODO context via Gemini `gemini-embedding-001` (768-dim), cosine-sims against cached project embeddings, takes top-5 candidates. Catches "this TODO is *about* the same thing as Project X" even with no shared page-refs.
3. **LLM final pick** — Live AI extension's `generate()` API picks the final project from the top-K candidates and returns the full attribute set. Uses Aliases::, breadcrumb context, and recent user corrections as few-shot examples.

User corrections feed back as future few-shot examples — the system gets better the more you correct it.

---

## Install

This is a `roam/js` extension, not a Roam Depot extension. To install:

1. Clone or download this repo to your local machine.
2. Open Roam, navigate to a `{{[[roam/js]]}}` block (create one on any utility page if you don't have one).
3. Paste the entire contents of `script.js` into the block.
4. Click "Yes, I know what I'm doing" when Roam prompts to run the new code.
5. Reload the tab so the new code initializes cleanly.

**Updating**: re-paste the new `script.js` contents over the old block content and reload. As of v1.7.3, `init()` automatically cleans up the previous version's timers, watchers, and cmd palette commands so re-paste doesn't double-fire.

**Requires**: [Live AI Assistant](https://github.com/fbgallet/roam-extension-live-ai-assistant) extension with **"Enable Public API"** toggled ON.

**Optional (for Phase 3 semantic embeddings)**: a free Gemini API key at <https://aistudio.google.com/apikey>. Free tier covers 1500 RPD, more than enough.

---

## Settings page

All settings live as inline-editable blocks on a dedicated page:

```
[[Auto-Attribute Settings]]
  - **How to use this page** — every setting below is `key:: value`. Edit inline...
  - enabled:: true
    - Master switch. false = the script ignores all TODOs.
  - auto_create_projects:: true
    - When AI suggests a new project that doesn't exist, auto-create the page...
  - clean_todo_text:: true
    - Rewrite the TODO title to remove hints captured into BT_attr children...
  - use_dropdown:: true
    - Emit BT_attrProject as {{or:}} dropdown so you can override the AI pick...
  - use_embeddings:: false
    - Phase 3 semantic ranker. Requires gemini_api_key. Falls back silently...
  - require_confirmation:: false
    - Suggestion-only mode. Logs the AI's pick but doesn't write BT_attr children.
  - sync_hub_on_scan:: true
    - Refresh [[Active Projects]] hub on each 15-min scan cycle.
  - gemini_api_key:: PASTE_YOUR_KEY_HERE
    - Free key at https://aistudio.google.com/apikey — covers 1500 RPD.
  - embedding_top_k:: 5
    - How many top-similarity projects to send to the LLM as candidates.
  - embedding_graph_weight:: 0.2
    - Tie-breaker weight for graph-Jaccard score (0 = pure semantic, 1 = pure graph).
  - confidence_threshold:: 0.6
    - Below this, BT_attrNotes gets a '(low conf — verify)' suffix.
  - daily_call_cap:: 100
    - Max LLM attribution calls per day.
  - debounce_ms:: 5000
    - ms to wait after a TODO is created/edited before processing.
  - auto_create_min_conf:: 0.7
    - AI must be at least this confident before auto-creating a new project page.
  - auto_create_daily_cap:: 5
    - Max new project pages auto-created per day.
  - log_retention_days:: 30
    - Auto-prune `[[Auto-Attribute TODO Log]]` entries older than this many days.
      Set very high (e.g. 99999) to disable pruning.
  - log_group_by_day:: true
    - Nest each new log entry under a `[[Month Dth, YYYY]]` parent block.
      Keeps the log page collapsible by day instead of one flat list.
  - follow_block_refs:: true
    - When a TODO title contains `((uid))` block-refs, fetch the referenced
      block + its `BT_attrProject` and feed both into the LLM as the strongest
      possible context signal. Catches "do final pass on `((other-todo))`"
      where the referenced block already has the project assigned.
  - block_ref_max_follow:: 5
    - Safety cap on number of `((uid))` refs resolved per TODO.
```

**To check current state of any toggle**: open the page, look at the value. That's the live state.

**To change a setting**: edit the value in the block (click into the block, change `true` → `false`, click out). Within 15 minutes the script picks up the change, or run cmd palette → **"Auto-Attribute: reload settings from graph"** for instant pickup.

**To see all toggles + runtime stats in one alert**: cmd palette → **"Auto-Attribute: show stats (current settings)"**.

The page is created automatically on first run. If you delete it, the next `init()` will re-create it with all defaults.

---

## Cmd palette commands

### Setup

| Command | What it does |
|---|---|
| **open settings page (edit toggles inline)** | Opens `[[Auto-Attribute Settings]]` in the right sidebar so you can flip toggles |
| **set Gemini API key (Phase 3 embeddings)** | Same as above — opens the settings page focused on the `gemini_api_key::` block |
| **reload settings from graph** | Re-reads every `key:: value` block; useful after editing the page |
| **show stats (current settings)** | Alert with ON/OFF for every toggle + runtime stats (cache size, calls today, etc.) |

### Toggles

These flip a value in memory AND write back to the graph page, so the page always reflects current state.

| Command | Setting flipped |
|---|---|
| **toggle enabled (master switch)** | `enabled` |
| **toggle suggestion-only mode** | `require_confirmation` |
| **toggle clean-text (rewrite TODO title)** | `clean_todo_text` |
| **toggle dropdown mode (BT_attrProject)** | `use_dropdown` |
| **toggle auto-create projects** | `auto_create_projects` |
| **toggle embeddings (Phase 3)** | `use_embeddings` |

### Operations

| Command | What it does |
|---|---|
| **process focused TODO now** | Forces re-process of the currently-focused block |
| **scan now** | Manual scan for unattributed TODOs (normally runs every 15 min) |
| **sync [[Active Projects]] hub now** | Refresh the hub page from `Project Status:: Active` queries |
| **archive a project** | Picker → sets `Project Status:: Archive` → removes from dropdown |
| **unarchive a project** | Picker → flips back to `Project Status:: Active` |
| **convert flat BT_attrProject to dropdown (bulk)** | Migration: `[[X]]` → `{{or: [[X]] | +attr:[[BT_attrProject]]}}` |
| **dedupe BT_attr children (cleanup duplicates)** | Scan all TODOs, delete duplicate `BT_attrX::` children, keep first |
| **rebuild all embeddings (force refresh)** | Re-embed every active project. Run after changing `embedding_model` |
| **clear processedToday cache (allow re-process)** | Re-run attribution on every TODO touched today |
| **prune log page now (delete old entries)** | Delete `[[Auto-Attribute TODO Log]]` entries older than `log_retention_days`. Runs once/day automatically; this command forces it. |
| **migrate flat log entries to per-day groups** | One-shot reorganization of legacy flat entries into `[[Month Dth, YYYY]]` parent blocks. Idempotent. |
| **toggle log grouping by day** | `log_group_by_day` |
| **toggle follow ((uid)) block-refs in TODOs** | `follow_block_refs` |
| **emergency stop (cleanup + disable)** | Kill all timers/watchers/cmds. Reload to restart. |

### Debug

| Command | What it does |
|---|---|
| **show stats** | See above |
| **show recent corrections** | Last N user corrections (used as few-shot examples) |
| **show graph-similarity for focused TODO** | Table of graph-Jaccard scores per project |
| **show embedding-similarity for focused TODO** | Table of semantic + graph + combined scores |
| **show embeddings cache** | List every cached project embedding (dim, hash, age) |
| **show active projects + aliases** | Table of all active projects and their `Aliases::` |
| **show ALL aliased entities** | Table of every page with an `Aliases::` block |
| **list projects by status** | Group all project pages by `Project Status::` value |
| **discover available embedding models** | Live `listModels` query — useful when Gemini rotates models |

---

## How it works

### The 5-second flow

1. You type `{{[[TODO]]}} review the EMP plan with Lori tomorrow` in any block.
2. The pull-watch fires; `schedule(uid)` queues a 5-second debounce timer (configurable via `debounce_ms`).
3. After 5 seconds, `processBlock(uid)` runs:
   - Marks the UID as "attempted today" up front (prevents loops on errors).
   - Skips if already has `BT_attrProject::`.
   - Calls `attribute(uid, text)`.
4. `attribute()` ranks projects:
   - If `use_embeddings: true` and key set → semantic ranker via Gemini embedding API + cosine similarity, combined with graph-Jaccard at weight 0.2.
   - Else → graph-Jaccard alone.
   - Top-K candidates pass to the LLM.
5. LLM (Live AI's `generate()`) picks final project, due offset, priority, energy, context, notes.
6. `insertAttrs` writes the `BT_attr` child blocks (skipping any key that already exists — race-safe).
7. Logs `OK [uid] → Project / Priority / conf 0.85` to `[[Auto-Attribute TODO Log]]`.

### Self-healing systems

The 15-minute scan cycle handles maintenance automatically:

- **Stale project content** → embedding hash mismatch → auto-re-embed
- **Archived projects** → GC'd from IDB cache
- **Gemini model rotation** → on first 404, query `listModels` and refresh the fallback chain
- **Inline settings edits** → `loadAllSettingsFromGraph` picks up any block you edited
- **Re-paste of `roam/js` block** → `init()` auto-cleans previous version's state

### Correction learning

When you change a `BT_attrProject` value (via Universal Selector dropdown or manual edit), a pull-watch fires and logs `(AIpick → userPick)` to `[[Auto-Attribute Corrections]]`. The last 10 corrections become few-shot examples in the LLM prompt. True RLHF-style: the system gets better the more you fix it.

---

## Files

- `script.js` — the entire extension. Single-file IIFE, no build step.
- `README.md` — this file.

---

## Architecture decisions

| Choice | Why |
|---|---|
| Gemini direct API for embeddings, not TF.js USE | Avoids 10MB model download + 30-50MB JS heap pressure. Identical browser/desktop/mobile behavior. ~$0 ongoing on free tier. |
| IDB for embedding cache, not localStorage | Embeddings (50 projects × 768 floats = ~150KB) are at the edge of localStorage's quota; IDB is the right tool for vector data. |
| Graph page as settings source of truth | Roam Desktop (Electron) blocks `window.prompt()` so we can't ask for the API key inline. The settings-page-with-inline-editable-blocks pattern is also the most "Roamy" — discoverable, version-controlled in the graph, editable via mobile. |
| Hardcoded fallback chain + listModels rescue | First 404 walks the chain (cheap); only if all hardcoded models 404 do we hit `listModels` (rare, but self-heals indefinitely). |
| Re-check `hasBTProject` after LLM call, before insertAttrs | The LLM call takes ~5s; in that window a parallel runner (debounce + pull-watch + ghost cmd) might already attribute the same TODO. Race-window guard avoids dupes without needing a true mutex. |

---

## Version history

- **v1.8.0** — Log future-proofing + block-ref following.
  - **Log housekeeping**: new entries nest under per-day parent blocks (`[[Month Dth, YYYY]]`), keeping the page collapsible. Auto-prune removes top-level day-parents (and any legacy flat entries) older than `log_retention_days` (default 30) once per session-day. New cmd palette: `prune log page now`, `migrate flat log entries to per-day groups`.
  - **Block-ref following**: when a TODO title contains `((uid))` refs, the script resolves each referenced block, surfaces its text + breadcrumb in the LLM prompt, expands the graph-Jaccard ref-set with the referenced block's page-refs, and treats the referenced block's own `BT_attrProject` as the strongest possible signal ("this TODO is follow-up work on that other block — same project"). Catches the previously-missed pattern "do final pass on `((some-other-todo))`".
- **v1.7.10** — `clean_todo_text` default OFF — LLM was stripping `(parens)` content + `#tags` once `BT_attrNotes`/`Project` captured them, mutating titles silently.
- **v1.7.4** — Unified `[[Auto-Attribute Settings]]` page; toggles persist to graph; show-stats panel.
- **v1.7.3** — Ghost cmd palette cleanup on init; insertAttrs dedup + race-window recheck; `discoverEmbeddingModels()` for self-healing.
- **v1.7.2** — Gemini embedding model rotation (default → `gemini-embedding-001`, fallback chain).
- **v1.7.1** — Roam-native key input via settings-page block (Electron blocks `prompt()`).
- **v1.7.0** — Phase 3 semantic embedding ranker via Gemini `text-embedding-004` (since superseded).
- **v1.6.0** — Project lifecycle commands (archive / unarchive / list-by-status).
- **v1.5.0** — Phase 2: graph-Jaccard pre-ranking + correction learning.
- **v1.4.0** — Strict project query, auto-create on by default, debounce 30s → 5s.
- **v1.3.0** — Auto-maintained `[[Active Projects]]` hub + auto-create projects from AI suggestions.
- **v1.2.x** — Top-3 dropdown via `{{or:}}`; JS regex clean-text fallback.
- **v1.1.x** — Aliases::-driven entity tagging; richer Roam context; debounce.
- **v1.0.x** — Initial: watch TODOs, call LiveAI, write BT_attr children.
