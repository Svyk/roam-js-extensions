# Roam JS Extensions — LiveAI_API integrations

Five `roam/js` scripts that hook `window.LiveAI_API.generate()` into your daily Roam workflow. Each is self-contained, idempotent, and silent until needed.

## What's in here

| Script | What it does | Trigger | Cost/run |
|---|---|---|---|
| **auto-attribute-todo** | Detects new `{{[[TODO]]}}` blocks → auto-fills `BT_attrProject`, `BT_attrDue`, `BT_attrPriority`, `BT_attrEnergy`, `BT_attrContext` as children | automatic on TODO create + 5-min safety scan | ~$0.001 (Haiku) |
| **explain-block** | Brief / detailed / translate / Lori-critique / define-terms passes on the focused block | command palette: `Explain block …` | ~$0.001-0.005 |
| **triage-ptn** | Classifies `#ptn` mobile captures as task / journal / decision / reference / obsolete and proposes a route | automatic on `#ptn` tag + 10-min scan | ~$0.001 |
| **daily-summary** | Inserts a 2-sentence "today's vibe" block at the top of today's daily page | command palette: `Daily Summary: refresh …` | ~$0.005 |
| **lori-review-button** | Runs Lori-Boyd-style 6-pass QA review on the current page (SOPs, deviations, EMP docs) | command palette: `Lori Review …` | ~$0.01-0.05 |
| **timeblock-organizer** | Watches daily pages; pulls time-prefixed TODOs into the `#TimeBlock` Nautilus parent, sorts by start-time, pins the SmartBlock timestamp button as last child | automatic on daily-page block changes (debounced 8s) + 5-min sweep | $0 (no LLM) |

All five share a design pattern:
- IIFE-wrapped, no global pollution beyond `window.<NAMESPACE>_state` for debugging
- Daily-cap guardrails on AI calls (~50-100/day per script)
- localStorage-based dedup (re-runs skip already-processed blocks)
- Logs each call to a dedicated `[[<name> Log]]` page in your graph for audit
- Command-palette hooks for manual triggers + stats + toggle-enabled
- Clean unload via `window.<NAMESPACE>_cleanup()`
- **Unified settings page** — every plugin auto-creates a dedicated `[[<Plugin> Settings]]` page on first run with every toggle as an inline-editable `key:: value` block. Edit the block, the script picks it up. Changes via cmd palette write back to the page. Source of truth lives in the graph.

## Settings pages

Each plugin has a dedicated settings page in your Roam graph. Open via cmd palette → `<Plugin>: open settings page (edit toggles inline)`. Edit values inline; the script reloads on the next scan or instantly via the matching `reload settings from graph` cmd.

| Plugin | Settings page |
|---|---|
| auto-attribute-todo | `[[Auto-Attribute Settings]]` |
| triage-ptn | `[[Triage PTN Settings]]` |
| daily-summary | `[[Daily Summary Settings]]` |
| explain-block | `[[Explain Block Settings]]` |
| lori-review-button | `[[Lori Review Settings]]` |
| update-roam-js | `[[Update Roam JS Settings]]` |
| timeblock-organizer | `[[TimeBlock Organizer Settings]]` |

To check current state of any toggle at a glance: open the settings page, look at the value, OR run cmd palette → `<Plugin>: show stats (current settings)` for a formatted ON/OFF panel.

---

## Prerequisites

1. **Live AI Assistant extension** installed in your Roam graph
2. **Public API enabled**: Roam settings → Live AI Assistant → toggle **"Enable Public API (window.LiveAI_API)"** to ON
3. At least one model configured with a valid API key in Live AI

Confirm the API is live: open Roam dev console and run `window.LiveAI_API?.isAvailable()` — should return `true`.

---

## One-time install (per script)

For each script you want active:

1. Open or create a Roam page named `roam/js/<script-name>` (e.g. `roam/js/auto-attribute-todo`)
2. Add a block with the text `{{[[roam/js]]}}`
3. Indent a child block beneath it
4. In that child block, paste the contents of `script.js` wrapped in a code block:
   ````
   ```javascript
   /* (paste script.js contents here) */
   ```
   ````
5. Refresh the page; Roam will prompt: "Allow JavaScript execution on this page?" — click **Yes** (it remembers per page)
6. Open the developer console — you should see `[<namespace>] v1.0.0 starting` log lines

The script auto-runs every time you load Roam after this. No further action needed.

### Faster install via the command palette

If you have the `Smartblocks` or `roam-js-loader` extension, you can wrap all five inside one `[[roam/js]]` page and let it auto-load all of them at startup. Otherwise one page per script is the safe default.

---

## Usage

### auto-attribute-todo
Type a TODO anywhere in your graph: `{{[[TODO]]}} review the EMP swab data with Lori`. Within ~3 seconds (the debounce), `BT_attrProject:: [[EMP Risk Matrix]]`, `BT_attrDue::`, `BT_attrPriority::`, `BT_attrEnergy::`, `BT_attrContext:: @work` appear as children. Done.

If the AI can't find a fitting active project, it inserts `BT_attrProject:: null` and a low-confidence `BT_attrNotes::` flag — review and fix manually.

Manual triggers (command palette → start typing "Auto-Attribute"):
- `process focused TODO now` — re-process the block under your cursor
- `toggle enabled` — disable temporarily
- `toggle suggestion-only mode` — log suggestions but don't auto-insert
- `scan now` — sweep the whole graph for unprocessed TODOs
- `show stats` — current call count, cap, processed-today

### explain-block
Focus any block, open command palette, start typing "Explain block":
- `(brief)` — 2-3 sentences on what's implicit
- `(detailed, nested)` — hierarchical explanation as nested children
- `translate (English ↔ Russian)` — auto-detects source language
- `critique (Lori Boyd lens)` — flags data-without-context, ambiguity, etc.
- `define unfamiliar terms` — bullet list of acronyms/jargon with definitions

### triage-ptn
Tag any block with `#ptn` (your existing mobile-capture convention). Within ~8 seconds it gets a child block: `triage:: **task** (conf 0.85) — Looks like a quick task. Suggested project: [[Wiki]], priority Low, due tomorrow.`

You can then accept by manually creating the BT, or invoke `auto-attribute-todo`'s "process focused TODO now" command after converting it to `{{[[TODO]]}}`.

### daily-summary
Open command palette → "Daily Summary: refresh top-of-day". A new block appears at position 0 of today's daily page: `Today's Vibe :: <2-sentence summary>`. Re-running overwrites it (idempotent).

Also: "refresh tomorrow's prep" — same flow on tomorrow's page, useful for an evening planning glance.

### lori-review-button
Open the SOP / deviation / document page you want reviewed. Command palette → "Lori Review: full" or "Lori Review: quick scan". A new "Lori Review — [date time]" block appears at the bottom of the page with grouped findings.

Full review covers all 6 passes (data context, undefined terms, ambiguous language, facility inconsistency, copy-paste, logical flow). Quick scan is just data + ambiguous language for a fast sanity check.

---

## Configuration

Each script's `DEFAULTS` object at the top is the source of settings. To override without editing the script, you can also expose a settings page (TODO: not yet wired — settings live in code for v1.0).

### Recommended LiveAI default model
For these scripts, set Live AI's default model to **claude-haiku-4-5** or **gpt-5.1-mini** — they're fast, cheap, and accurate enough for classification and summarization. Reserve power-tier models for explicit high-effort prompts.

---

## Cost ceiling

Hard caps per script:
- auto-attribute-todo: 100 calls/day (~$0.10)
- triage-ptn: 80 calls/day (~$0.08)
- explain-block: no cap (manual trigger)
- daily-summary: no cap (manual trigger)
- lori-review-button: no cap (manual trigger)

Manual-trigger scripts are uncapped because you're paying for each invocation deliberately. The two automatic scripts (auto-attribute-todo, triage-ptn) have caps because runaway loops on a malformed graph could otherwise generate hundreds of calls.

Realistic monthly cost on a heavy-usage day: $1-3 across all five scripts.

---

## Troubleshooting

**"LiveAI_API not available" in console**
- LiveAI extension not loaded yet (try refresh)
- Public API toggle off (Roam settings → Live AI Assistant)
- No model configured (need at least one provider's API key in Live AI settings)

**Script doesn't fire on TODO create / #ptn tag**
- Open command palette, run `Auto-Attribute: scan now` (or `Triage PTN: scan now`) — forces a one-time sweep
- Check the `[[Auto-Attribute TODO Log]]` page for recent calls
- Check console for `[auto-attr-todo]` log lines

**Wrong project assigned**
- The AI looks at pages with `Project Status:: Active`. If a project page is missing that attribute, it won't be considered. Add the attribute to surface it.

**Script execution disallowed**
- Roam asks per-page; you may have clicked "No" the first time. Refresh the script's page and click "Yes" when re-prompted.

**Want to disable a script temporarily**
- Command palette: `Auto-Attribute: toggle enabled` (or equivalent for other scripts)
- For permanent disable: delete the `{{[[roam/js]]}}` block from its page

**Want to uninstall**
- Run `window.<namespace>_cleanup()` in the console (e.g. `window["auto-attr-todo_cleanup"]()`) to unregister watchers
- Delete the `roam/js/<name>` page

---

## Auto-update

This whole `~/roam-js-extensions/` tree is captured by `system-sync.sh` (via the `.system-sync-include` marker at the root) and pushed to `github.com/Svyk/system-setup/roam-js-extensions/` on every nightly sync. To pull updates from the repo, edit the script's Roam page with the new version (or build a fancier deploy mechanism later).

---

## Build new scripts

The pattern is consistent across all five:

```js
;(function () {
  const VERSION = "1.0.0";
  const NAMESPACE = "my-script";
  /* state, helpers, processor, watcher, command palette, init */
  init();
})();
```

Use `window.LiveAI_API.generate({ prompt, systemPrompt, useDefaultSystemPrompt: false, roamContext: { ... }, responseFormat: "json_object", caller: "my-script/1.0" })`. Honour the daily cap pattern. Log to a dedicated `[[<Name> Log]]` Roam page for audit. Register cleanup on `window.<NAMESPACE>_cleanup`.

See `auto-attribute-todo/script.js` for the most fully-featured reference (pull-watch + scan + cmd palette + dedup + Roam logging).
