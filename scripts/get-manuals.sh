#!/usr/bin/env bash
# Kept for convenience: downloads every manual listed in docs/modules.json.
set -euo pipefail
exec node "$(dirname "$0")/manuals.mjs" fetch
