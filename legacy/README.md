# Frozen `roam/js` suite

This directory preserves the pre-Depot scripts, shared library, manifest, updater, and operating notes. It is retained for audit and rollback only.

- Immutable baseline: Git tag `roam-js-final`
- Canonical new installs: the catalog in the repository root
- Retired component: `update-roam-js` (never combine it with Depot extensions)

The manifest keeps its historical paths and is not an active update feed. For a rollback, fetch a script from the `roam-js-final` tag rather than from `main`.
