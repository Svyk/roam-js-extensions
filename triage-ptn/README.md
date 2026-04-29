# triage-ptn

Watches blocks tagged `#ptn` (mobile "process this now" capture) and inserts a single classification suggestion via Live AI. Does NOT auto-mutate — just suggests `task | journal | decision | reference | obsolete` plus a recommended next action. You decide what to do with it.

---

## Install

1. Paste contents of `script.js` into a `{{[[roam/js]]}}` block in Roam, save, reload.
2. Requires [Live AI Assistant](https://github.com/fbgallet/roam-extension-live-ai-assistant) with **"Enable Public API"** ON.

Updating is the same — re-paste the new contents and reload. `init()` auto-cleans up the previous version's timers/watchers/cmd-palette commands.

---

## Settings page

All settings live as inline-editable blocks on `[[Triage PTN Settings]]`. Edit a value, the script picks it up on the next 20-min scan (or instantly via the "reload settings from graph" cmd).

| Block | Default | What it controls |
|---|---|---|
| `enabled:: true` | true | Master switch. false = ignore #ptn blocks entirely. |
| `auto_archive_on_scan:: true` | true | Each scan moves date buckets older than retention into a quarterly archive page. |
| `log_retention_days:: 30` | 30 | Days of log entries to keep on the live `[[Triage PTN Log]]` page. |
| `daily_call_cap:: 80` | 80 | Max LLM classifications per day. |
| `debounce_ms:: 8000` | 8000 | ms to wait before classifying a fresh #ptn block (mobile bursts). |
| `scan_budget_per_cycle:: 10` | 10 | Max blocks processed per 20-min scan cycle. |
| `min_text_length:: 8` | 8 | Skip blocks shorter than this (avoids triaging garbage). |

To check current state at a glance: open `[[Triage PTN Settings]]` and look at the values, OR run cmd palette → **"Triage PTN: show stats (current settings)"**.

---

## Log structure (v1.1.0+)

`[[Triage PTN Log]]` now nests entries under daily date-bucket parent blocks instead of dumping every entry as a flat child of the page. Old (pre-v1.1.0) graphs accumulated 100s-1000s of flat entries — the v1.1.0 rewrite includes a one-time **"compact existing log into date buckets"** command that flattens them.

```
[[Triage PTN Log]]
  - [[April 28th, 2026]]            ← collapsed by default; expand to see today's entries
    - 14:32:01 [block-uid] → task (conf 0.92)
    - 14:51:20 [block-uid] → journal (conf 0.78)
  - [[April 27th, 2026]]
    - ...
```

Buckets older than `log_retention_days` are auto-moved to `[[Triage PTN Log/Archive YYYY-Qn]]` quarterly archive pages on each scan cycle. Keeps the live page lean indefinitely.

---

## Cmd palette commands

### Setup / settings
- **open settings page (edit toggles inline)** — opens `[[Triage PTN Settings]]` in the right sidebar
- **reload settings from graph** — re-reads every `key:: value` block; useful after editing the page
- **show stats (current settings)** — alert + console with ON/OFF for every toggle + runtime stats

### Toggles (each writes back to the settings page)
- **toggle enabled (master switch)**
- **toggle auto-archive on scan**

### Operations
- **process focused block now** — force re-classify the focused block
- **scan now** — manual scan for un-triaged #ptn blocks
- **compact existing log into date buckets (one-time)** — migrate flat v1.0.x log entries into date-bucket parents
- **archive old log buckets now** — manual run of the retention sweep
- **emergency stop** — kill all timers/watchers/cmds. Reload to restart.
- **clear processedToday cache** — re-run classification on every #ptn block touched today

---

## How it works

1. You write `journal: had a great workout #ptn` on your phone.
2. Roam syncs; the pull-watch on `#ptn` fires.
3. After 8s debounce (lets you keep typing), `processBlock()` runs.
4. `classify()` calls Live AI's `generate()` with the block + breadcrumb context.
5. LLM returns `{classification, suggested_action, confidence}`.
6. Re-checks: did anything else add a `triage::` child while we were waiting? If yes, skip (race-window guard).
7. Inserts ONE child block: `triage:: **journal** (conf 0.85) — append to today's daily page under #feeling`.
8. Logs to `[[Triage PTN Log]]` under today's date bucket.
9. You read the suggestion, accept or reject manually. The script doesn't auto-route.

---

## Version history

- **v1.1.0** — Date-bucketed log + auto-archive + unified settings page; idempotent commands + auto-cleanup on init + race guard. Parity with auto-attribute-todo v1.7.4.
- **v1.0.5** — Fence-collision fix in regex source.
- **v1.0.4** — Plain `[uid]` text in log entries (not `((uid))` refs).
- **v1.0.3** — Stop retry loop; mark uid attempted-today before LLM call.
- **v1.0.0** — Initial: watch #ptn, classify via LiveAI, insert one suggestion.
