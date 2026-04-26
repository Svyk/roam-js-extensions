# One-time install — Roam JS Extensions (LiveAI_API suite)

This tells Roam to fetch all 6 scripts from public GitHub and install them automatically. You only ever paste **one** script by hand — the bootstrap. After that, all installs and updates are command-palette commands inside Roam.

## Prerequisites

1. **Live AI Assistant** extension installed in your Roam graph
2. **Public API enabled**: Roam settings → Live AI Assistant → toggle **"Enable Public API (window.LiveAI_API)"** → ON
3. (Recommended) Set Live AI's default model to a fast/cheap one — `claude-haiku-4-5` or `gpt-5.1-mini` — for the auto-running scripts

Verify the API: open Roam dev console (cmd-opt-i) → run `window.LiveAI_API?.isAvailable()` → should return `true`.

## Step 1: Install the bootstrap (one paste)

1. Create a new Roam page named exactly: `roam/js/update-roam-js`
2. Add a block on that page with the text: `{{[[roam/js]]}}`
3. Indent a child block beneath it (Tab)
4. Paste the **entire contents** of [`update-roam-js/script.js`](https://raw.githubusercontent.com/Svyk/roam-js-extensions/main/update-roam-js/script.js) into the child block, wrapped in a triple-backtick `javascript` code fence:

   ````
   ```javascript
   /* update-roam-js v1.0.0 ... */
   (paste the rest of script.js here)
   ```
   ````

5. Refresh the page (cmd-r). Roam will prompt: **"Allow JavaScript execution on this page?"** → click **Yes** (it remembers per page)
6. Open the dev console — you should see `[update-roam-js] v1.0.0 starting` log lines

## Step 2: Install the rest (one command)

Open Roam's command palette (cmd-p) and start typing: **"Update Roam JS"**. You'll see commands like:

- `Update Roam JS: install all scripts`
- `Update Roam JS: list available scripts`
- `Update Roam JS: install auto-attribute-todo`
- `Update Roam JS: install explain-block`
- … (one per script)

Run **`install all scripts`**. The bootstrap fetches each script from public GitHub and creates the appropriate `roam/js/<name>` page with the `{{[[roam/js]]}}` block and the code child already in place.

After this, **for each newly installed script**: open its `roam/js/<name>` page, refresh, and click **Yes** when Roam asks to allow JS execution. (Roam needs a per-page approval — there's no way around this; it's a security feature.)

## Step 3: Verify everything's running

Open dev console. You should see one `[<namespace>] v1.0.0 starting` line per installed script:
- `[auto-attr-todo]`
- `[explain-block]`
- `[triage-ptn]`
- `[daily-summary]`
- `[lori-review-button]`
- `[update-roam-js]`

If any are missing, navigate to the corresponding `roam/js/<name>` page and refresh + accept the JS prompt.

## Day-to-day use

See `README.md` for the per-script trigger / cost details.

## Updating

When a new version of a script ships to the repo, the bootstrap detects it on next graph load (24h cache) and logs a console warning. To apply:

- `Update Roam JS: check for updates now` — see what's stale
- `Update Roam JS: update all scripts to latest` — apply all
- `Update Roam JS: update <name>` — apply just one

After updating, refresh the corresponding `roam/js/<name>` page to reload it.

## Uninstalling

- `Update Roam JS: uninstall <name>` — calls the script's cleanup, deletes the page
- To remove the whole suite: uninstall each, then delete `roam/js/update-roam-js`

## Troubleshooting

**Manifest fetch fails** — your network is blocking `raw.githubusercontent.com`, or the public repo isn't deployed yet. Try fetching the URL in a browser tab. If it works there but not in Roam, check Roam's CSP — usually fine for raw.githubusercontent.com.

**JavaScript execution disallowed** — you clicked "No" once. Refresh the `roam/js/<name>` page; it'll re-prompt.

**`window.LiveAI_API not available`** — Live AI extension not loaded yet (refresh), or Public API toggle is off.

**Scripts install but don't run** — each `roam/js/<name>` page needs an individual "Allow JS" approval. Visit each page once, refresh, click Yes.
