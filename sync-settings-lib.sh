#!/bin/bash
# sync-settings-lib.sh
#
# Inlines _lib/settings-page.js into each plugin's script.js between the
# markers `/* === === SETTINGS-PAGE LIB START` and `/* === === SETTINGS-PAGE LIB END`.
#
# Run this whenever you edit _lib/settings-page.js. The plugins are still
# self-contained roam/js files (no runtime global dependency), but the source
# of truth for the helpers lives in one place.
#
# Usage: bash sync-settings-lib.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
LIB="$REPO_ROOT/_lib/settings-page.js"
PLUGINS=(auto-attribute-todo explain-block lori-review-button daily-summary update-roam-js timeblock-organizer)

if [[ ! -f "$LIB" ]]; then
  echo "ERROR: $LIB not found"
  exit 1
fi

for p in "${PLUGINS[@]}"; do
  TARGET="$REPO_ROOT/$p/script.js"
  if [[ ! -f "$TARGET" ]]; then
    echo "skip: $p/script.js not found"
    continue
  fi
  if ! grep -q "=== SETTINGS-PAGE LIB START" "$TARGET"; then
    echo "skip: $p/script.js has no START marker (not yet refactored)"
    continue
  fi
  if ! grep -q "=== SETTINGS-PAGE LIB END" "$TARGET"; then
    echo "WARN: $p/script.js has START but no END marker — fix manually"
    continue
  fi

  # Use awk to splice: keep everything BEFORE the START marker, insert lib,
  # keep everything AFTER the END marker. Preserves indentation of markers.
  TMP="$(mktemp)"
  awk -v libfile="$LIB" '
    BEGIN { in_block = 0; lib_inserted = 0 }
    /=== SETTINGS-PAGE LIB START/ {
      print
      in_block = 1
      while ((getline line < libfile) > 0) {
        # Skip the lib file'"'"'s own START/END marker lines (we keep the plugin'"'"'s)
        if (line ~ /=== SETTINGS-PAGE LIB START/) continue
        if (line ~ /=== SETTINGS-PAGE LIB END/) continue
        print "  " line
      }
      close(libfile)
      lib_inserted = 1
      next
    }
    /=== SETTINGS-PAGE LIB END/ {
      in_block = 0
      print
      next
    }
    !in_block { print }
  ' "$TARGET" > "$TMP"

  if ! diff -q "$TARGET" "$TMP" >/dev/null; then
    mv "$TMP" "$TARGET"
    echo "synced: $p/script.js"
  else
    rm "$TMP"
    echo "unchanged: $p/script.js"
  fi
done

echo ""
echo "validating syntax..."
for p in "${PLUGINS[@]}"; do
  TARGET="$REPO_ROOT/$p/script.js"
  [[ ! -f "$TARGET" ]] && continue
  if node --check "$TARGET" 2>/dev/null; then
    echo "  OK $p"
  else
    echo "  FAIL $p"
    node --check "$TARGET" 2>&1 | head -5
  fi
done
