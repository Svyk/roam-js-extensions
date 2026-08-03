# Svyk Roam extension catalog

This repository is the migration catalog for Svyk's personal Roam extensions. New installs use one Depot-compatible URL per extension. The former `roam/js` suite is frozen under [`legacy/`](legacy/) and preserved by the `roam-js-final` tag.

## Extensions

| Extension | Install URL | Purpose |
|---|---|---|
| Roam Grid | `https://svyk.github.io/roam-grid` | Native-backed advanced tables and large grids |
| Auto Attribute | `https://svyk.github.io/roam-auto-attribute` | AI-assisted task attributes |
| TimeBlock Organizer | `https://svyk.github.io/roam-timeblock-organizer` | Sort and validate daily-page time blocks |
| Live AI Toolkit | `https://svyk.github.io/roam-live-ai-toolkit` | Explain, summarize, and review commands |
| Archive TODOs | `https://svyk.github.io/roam-archive-todos` | Archive completed TODOs safely |
| Hide DONE | `https://svyk.github.io/roam-hide-done` | Hide completed tasks without deleting blocks |

The five non-Grid URLs are the canonical future endpoints. They become installable after their repositories enable the included GitHub Pages workflows.

## Install on each computer

Roam extension enablement is local to each browser profile, so repeat this on every computer:

1. Open **Settings → Roam Depot → Developer Extensions** and enable developer mode.
2. Choose **Load extension from URL** and paste the extension's install URL from the table above.
3. Enable the extension and reload Roam once.
4. Verify its command-palette entries and settings before disabling the corresponding legacy script.

Do not load the compiled `extension.js` through a `{{[[roam/js]]}}` block. Depot owns loading, updates, and lifecycle cleanup.

## Cut over safely

Migrate one extension at a time:

1. Record the current graph settings and confirm the new extension works on a disposable page.
2. Disable the matching legacy `roam/js/<name>` page or its `{{[[roam/js]]}}` block.
3. Reload and verify that only one copy is running. Duplicate command names or duplicate writes mean both loaders are still active.
4. Keep the legacy page for rollback until the new extension has been stable on every client.

`update-roam-js` is retired. It must not be used to update Depot extensions.

## Roll back

1. Disable the Depot extension on the affected client.
2. Restore the old script from the immutable `roam-js-final` tag, for example:
   `https://raw.githubusercontent.com/Svyk/roam-js-extensions/roam-js-final/auto-attribute-todo/script.js`
3. Re-enable the legacy `{{[[roam/js]]}}` page and reload Roam.

No legacy history was deleted; the complete former suite, manifest, installer, and updater remain in [`legacy/`](legacy/).

## Security model

- Treat every compiled bundle as executable code. Review the repository and release diff before enabling an update.
- Bundles and catalog files contain no API keys or graph tokens. Provider credentials remain in the owning Roam extension/settings store.
- Public bundles are intentional so Depot can fetch them. Never publish graph data, `.env` files, API keys, or Roam graph tokens.
- Installation trust is per browser profile. Only use the exact HTTPS URLs listed above.

## Validate the catalog

```bash
npm run check
```

This verifies the six canonical URLs, README/catalog agreement, the frozen legacy layout, and common secret patterns.
