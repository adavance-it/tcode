#!/usr/bin/env bash
#
# tercode installer.
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/josematiasrivero/tercode/main/install.sh | bash
#
# Env overrides:
#   TERCODE_REPO   git URL to clone   (default: https://github.com/josematiasrivero/tercode.git)
#   TERCODE_DIR    install location   (default: $HOME/dev/tercode)
#   TERCODE_REF    branch / tag / sha (default: main)
#
set -euo pipefail

REPO_URL="${TERCODE_REPO:-https://github.com/josematiasrivero/tercode.git}"
TARGET_DIR="${TERCODE_DIR:-$HOME/dev/tercode}"
REF="${TERCODE_REF:-main}"

if [ -t 1 ]; then
  C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

log()  { printf "%s==>%s %s\n" "$C_BLUE"   "$C_RESET" "$*"; }
ok()   { printf "%s ok%s %s\n" "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf "%s !!%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf "%s xx%s %s\n" "$C_RED"    "$C_RESET" "$*" >&2; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

main() {
  log "tercode installer"
  require git
  require node
  require npm

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -lt 18 ]; then
    err "Node 18+ required, found $(node -v)"
    exit 1
  fi

  if [ -d "$TARGET_DIR/.git" ]; then
    log "Updating existing checkout at $TARGET_DIR"
    git -C "$TARGET_DIR" fetch --depth=1 origin "$REF"
    git -C "$TARGET_DIR" checkout "$REF"
    git -C "$TARGET_DIR" reset --hard "origin/$REF" 2>/dev/null || true
  else
    if [ -e "$TARGET_DIR" ]; then
      err "$TARGET_DIR exists but is not a git checkout."
      err "Move it aside or set TERCODE_DIR to another path."
      exit 1
    fi
    log "Cloning $REPO_URL into $TARGET_DIR"
    mkdir -p "$(dirname "$TARGET_DIR")"
    git clone --depth=1 --branch "$REF" "$REPO_URL" "$TARGET_DIR"
  fi

  cd "$TARGET_DIR"

  log "Installing dependencies"
  npm install --silent --no-audit --no-fund

  log "Building"
  npm run --silent build

  log "Linking 'tercode' on your PATH"
  npm link --silent

  if command -v tercode >/dev/null 2>&1; then
    ok "Installed at $(command -v tercode)"
    ok "Try it:  tercode ~/some/repo"
  else
    warn "Built and linked, but 'tercode' is not on your PATH."
    warn "Add npm's global bin to PATH and reopen your shell:"
    warn "  export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
  fi
}

main "$@"
