#!/usr/bin/env bash
# oh-my-copilot — one-line installer
#
# Usage (from a fresh machine):
#   curl -fsSL https://raw.githubusercontent.com/jjongyn/oh-my-copilot/main/install.sh | bash
#
# Or if you already cloned the repo:
#   ./install.sh

set -e

REPO_URL="https://github.com/jjongyn/oh-my-copilot.git"
INSTALL_DIR="${OHM_INSTALL_DIR:-$HOME/.oh-my-copilot-install}"

BOLD="\033[1m"
GREEN="\033[0;32m"
RESET="\033[0m"

info() { echo -e "${BOLD}[omc]${RESET} $*"; }
ok()   { echo -e "${GREEN}[ok]${RESET}  $*"; }

# If running from inside the already-cloned repo, just call setup.sh directly
if [ -f "$(dirname "$0")/scripts/setup.sh" ] && [ -d "$(dirname "$0")/bridge" ]; then
  exec "$(dirname "$0")/scripts/setup.sh" "$@"
fi

# Prerequisites
command -v git >/dev/null 2>&1 || { echo "git is required. Install git first."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required. See https://nodejs.org"; exit 1; }

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating oh-my-copilot at $INSTALL_DIR ..."
  git -C "$INSTALL_DIR" pull --quiet --ff-only
  ok "Updated"
else
  info "Cloning oh-my-copilot to $INSTALL_DIR ..."
  git clone --quiet --depth=1 "$REPO_URL" "$INSTALL_DIR"
  ok "Cloned"
fi

# Run the setup from the cloned directory
exec "$INSTALL_DIR/scripts/setup.sh" "$@"
