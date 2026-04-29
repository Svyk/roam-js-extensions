# Plan: settings-page pattern for every roam/js plugin

After auto-attribute-todo v1.7.4 + triage-ptn v1.1.0 both adopted the inline-editable graph settings page, every other plugin in this repo should follow. This doc lays out the pattern, scope, and proposed schema per plugin.

## The pattern (proven across two plugins)

Each plugin gets:

1. **A dedicated Roam page** named `[[<Plugin> Settings]]`
2. **A `GRAPH_SETTINGS` constant** declaring every user-controllable value:
   ```js
   const GRAPH_SETTINGS = [
     // [graphKey, settingsKey, type, default, description]
     ["enabled", "enabled", "bool", true, "Master switch."],
     // ...
   ];
   ```
3. **Five helpers** (~150 LOC, copy-pasted between plugins for now):
   - `parseSettingValue(type, raw)` — bool/int/float/string parser
   - `formatSettingValue(type, value)` — round-trip formatter
   - `loadAllSettingsFromGraph()` — reads every recognized `key:: value` block
   - `ensureSettingsBlock(...)` + `ensureSettingsPage(open)` — idempotent page bootstrap
   - `persistSettingToGraph(key)` — writes one value back when toggle cmd flips it
4. **Four standard cmd palette commands**:
   - `<Plugin>: open settings page (edit toggles inline)`
   - `<Plugin>: reload settings from graph`
   - `<Plugin>: show stats (current settings)`
   - `<Plugin>: toggle <each-bool-setting>` (one per bool)
5. **Init hook** that calls `ensureSettingsPage(false).then(loadAllSettingsFromGraph)` after `loadPersistentSettings()` (graph wins over localStorage on disagreement).
6. **Scan hook** that calls `loadAllSettingsFromGraph()` each cycle (so inline edits propagate without manual reload).

## Why this pattern

| Property | Why it matters |
|---|---|
| Graph is source of truth | The page IS the live state. Answers "is X on right now?" with one glance, no console-spelunking. |
| Inline-editable blocks | No prompt() / no settings UI. Roam Desktop (Electron) blocks `prompt()` anyway. |
| Toggles round-trip | Cmd palette flip → state → graph block update → page reflects new state. Graph edit → next scan → state updates. Either direction works. |
| localStorage cache | Fast init; no graph query needed before first render. Graph wins on disagreement. |
| Idempotent bootstrap | Re-init creates missing setting blocks, never overwrites existing values. Safe to re-paste the script anytime. |
| Description as child block | Each `key:: value` block has a child block explaining what it does. Self-documenting. |

## Inventory of remaining plugins (3 to migrate)

### `daily-summary/script.js`
**Current settings (in DEFAULTS):** TBD — needs read.
**Estimated graph settings:**
- `enabled` (bool)
- `daily_summary_time` (string, HH:MM format) — when to write the summary
- `summary_target_page` (string) — page to write to
- `include_completed_todos` (bool)
- `include_meeting_recap` (bool)
- `model_override` (string) — LLM model to use for summary
**Effort: ~30 min**

### `explain-block/script.js`
**Current settings (in DEFAULTS):** TBD — needs read.
**Estimated graph settings:**
- `enabled` (bool)
- `default_target` (string) — sidebar | new-block | popup
- `model_override` (string)
- `temperature` (float)
- `system_prompt_override` (string, multi-line) — power-user control
**Effort: ~20 min**

### `lori-review-button/script.js`
**Current settings (in DEFAULTS):** TBD — needs read.
**Estimated graph settings:**
- `enabled` (bool)
- `button_label` (string) — "Lori review" or custom
- `review_target` (string) — child-block | sidebar
- `model_override` (string)
- `tracked_changes_format` (bool) — emit as tracked-changes-style annotations
**Effort: ~25 min**

### `update-roam-js/script.js`
**Current settings (in DEFAULTS):** TBD — needs read.
**Estimated graph settings:**
- `enabled` (bool)
- `repo_url` (string) — github.com/Svyk/roam-js-extensions
- `auto_check_on_load` (bool)
- `check_interval_hours` (int)
**Effort: ~20 min**

**Total scope: ~95 min for all 4 plugins.**

## Refactor: extract the helpers into a shared file

After all 5 plugins ship the pattern, the ~150 LOC helper block should be DRY'd. Options:

1. **A dedicated `_lib/settings-page.js`** in this repo. Each plugin's `script.js` starts with: paste this lib first, then the plugin-specific code. The user pastes BOTH into the `roam/js` block (they concatenate). Pro: zero runtime overhead. Con: still copy-paste of the lib at install time.

2. **A namespaced global `window.RoamPluginSettings`** that the lib script registers. Each plugin checks for it and uses it. Pro: install once, reuse everywhere. Con: install order matters (lib must run first); more moving parts.

3. **Status quo: each plugin has its own copy.** ~150 LOC × 5 = 750 LOC duplicated. Pro: zero coupling, each plugin is self-contained. Con: drift risk — fixes have to land in 5 places.

**Recommendation**: (3) for now (we have 2 plugins shipped). Re-evaluate after the 3rd plugin migrates — if the helpers genuinely never change between plugins, move to (1). If they diverge (different parsers, different schemas), stay at (3).

## Migration order

Recommend tackling in this order:

1. **`update-roam-js`** (~20 min, simplest — settings are obvious and few)
2. **`explain-block`** (~20 min, also small)
3. **`lori-review-button`** (~25 min)
4. **`daily-summary`** (~30 min, biggest config surface)

Each migration is one PR-equivalent commit. Validate via `node --check` before pasting into Roam.

## Schema for the global readme

After all 5 ship, top-level `~/roam-js-extensions/README.md` gains a "Settings pages" section:

```
## Settings pages

Every plugin in this repo has a `[[<Plugin> Settings]]` page in your Roam graph
where you can flip toggles inline. Open via cmd palette → "<Plugin>: open
settings page".

| Plugin | Settings page |
|---|---|
| auto-attribute-todo | [[Auto-Attribute Settings]] |
| triage-ptn | [[Triage PTN Settings]] |
| daily-summary | [[Daily Summary Settings]] |
| explain-block | [[Explain Block Settings]] |
| lori-review-button | [[Lori Review Settings]] |
| update-roam-js | [[Update Roam JS Settings]] |
```

## Open questions

- **Should we also expose `model_override` per plugin?** Yes — plugins that call `LiveAI_API.generate()` should let the user pick the model on the settings page. The default is "use LiveAI's default model" but power users may want a specific one (e.g. claude-sonnet-4 for explain-block, gpt-5.1-mini for daily-summary to save cost).
- **Should `gemini_api_key` be shared across plugins?** YES, eventually. Right now each plugin would need its own copy. Cleanest solution: a top-level `[[Roam JS Plugins Settings]]` page with a single `gemini_api_key::` block that every plugin reads. Graph-cross-page reads are cheap; this is a one-line query change. Defer this until 2+ plugins actually need Gemini.
