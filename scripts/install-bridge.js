#!/usr/bin/env node
/**
 * Postinstall: auto-install the oh-my-copilot-bridge VSCode extension.
 * Tries `code` (VSCode) then `cursor` (Cursor). Prints instructions if neither found.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PKG_DIR = path.join(__dirname, '..');
const BRIDGE_DIR = path.join(PKG_DIR, 'bridge');

function findVsix() {
  if (!fs.existsSync(BRIDGE_DIR)) return null;
  const candidates = fs.readdirSync(BRIDGE_DIR)
    .filter(file => /^oh-my-copilot-bridge-.*\.vsix$/.test(file))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return candidates.length > 0 ? path.join(BRIDGE_DIR, candidates[0]) : null;
}

const VSIX = findVsix();

if (!VSIX || !fs.existsSync(VSIX)) {
  console.log('\n  [omc] Bridge VSIX not found — skipping auto-install.');
  return;
}

function tryInstall(editor) {
  try {
    execSync(`${editor} --install-extension "${VSIX}" --force`, {
      stdio: 'pipe',
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

console.log('\n  oh-my-copilot: installing bridge extension...');

if (tryInstall('code')) {
  console.log('  ✓ Bridge extension installed into VSCode');
  console.log('  → Open VSCode and run: omc\n');
} else if (tryInstall('cursor')) {
  console.log('  ✓ Bridge extension installed into Cursor');
  console.log('  → Open Cursor and run: omc\n');
} else {
  console.log('  ⚠ Could not auto-install bridge (VSCode/Cursor CLI not in PATH).');
  console.log('  → Install manually:');
  console.log(`    code --install-extension "${VSIX}"`);
  console.log('  → Or: Extensions panel → ··· → Install from VSIX\n');
}
