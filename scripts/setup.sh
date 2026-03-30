#!/usr/bin/env bash
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()  { echo -e "${BOLD}[omc]${RESET} $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET} $*"; }
die()   { echo -e "${RED}[err]${RESET}  $*"; exit 1; }

echo ""
echo "  oh-my-copilot — setup"
echo "  ─────────────────────"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
BRIDGE_DIR="$ROOT_DIR/bridge"

# ── Prerequisites ──────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js 18+ is required. Install from https://nodejs.org"
NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18+ required (found $(node --version))"
ok "Node.js $(node --version)"

# ── Build & link CLI ────────────────────────────────────────────────────────────
info "Building oh-my-copilot CLI..."
cd "$SRC_DIR"
npm install --silent
npm run build --silent
npm link --silent 2>/dev/null || sudo npm link --silent
ok "CLI installed — run \`omc\` to launch"
cd "$ROOT_DIR"

# ── Install VSCode extension ────────────────────────────────────────────────────
VSIX_PATH="$(find "$BRIDGE_DIR" -maxdepth 1 -name 'oh-my-copilot-bridge-*.vsix' | sort | tail -n 1)"

if [ -z "$VSIX_PATH" ]; then
  warn "Bridge VSIX not found under $BRIDGE_DIR"
  warn "Build/package it first, or install the extension manually from the bridge directory."
fi

if [ -n "$VSIX_PATH" ] && command -v code >/dev/null 2>&1; then
  info "Installing bridge extension into VSCode..."
  code --install-extension "$VSIX_PATH" --force
  ok "Bridge extension installed"
elif [ -n "$VSIX_PATH" ] && command -v cursor >/dev/null 2>&1; then
  info "Installing bridge extension into Cursor..."
  cursor --install-extension "$VSIX_PATH" --force
  ok "Bridge extension installed (Cursor)"
elif [ -z "$VSIX_PATH" ]; then
  warn "Bridge VSIX not available, so extension auto-install was skipped."
else
  warn "VSCode/Cursor CLI not found in PATH."
  warn "Install manually: Extensions panel → ··· → Install from VSIX → ${VSIX_PATH}"
fi

echo ""
echo "  Setup complete."
echo ""
echo "  Next steps:"
echo "  1. Open VSCode — the bridge starts automatically"
echo "  2. Verify: Command Palette → 'Oh My Copilot: Show Bridge Status'"
echo "  3. In your terminal: omc"
echo ""
