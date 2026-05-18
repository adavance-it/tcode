#!/usr/bin/env bash
#
# run-desktop.sh — launch the tcode desktop app.
#
# First run installs dependencies (downloads Electron); after that it just
# opens the window. All arguments are forwarded to the app, e.g.
#
#   ./run-desktop.sh                 # browse the current directory
#   ./run-desktop.sh ~/dev/myrepo    # browse a specific directory
#   ./run-desktop.sh --light repo/   # forward any tcode flag
#
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x node_modules/.bin/electron ]; then
  echo "==> First run — installing dependencies (this downloads Electron)…"
  npm install --no-audit --no-fund
fi

# cli.js handles root → --no-sandbox, `update`, `--help` and arg forwarding.
exec node desktop/cli.js "$@"
