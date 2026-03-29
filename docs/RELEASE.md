# Release Checklist

## Preflight

```bash
npm run verify
omc doctor --verbose
```

## Bridge

```bash
cd bridge
npm install
npm run compile
npx vsce package --no-dependencies
```

Confirm a fresh `oh-my-copilot-bridge-*.vsix` is produced and installable in both VS Code and Cursor.

## Manual Smoke Test

1. Open VS Code or Cursor with the bridge extension active.
2. Run `omc`.
3. Check `/init`, `/mcp`, `/background`, `/agent basic`, and `/agent sisyphus`.
4. Run one interactive task and one `omc run "<task>"` task.
5. Confirm `omc doctor --verbose` reports bridge, models, editor tools, and MCP discovery correctly.

## Package Metadata

Check these before publishing:

- root `package.json` version
- `src/package.json` version
- `bridge/package.json` version
- README install instructions
- latest bridge VSIX file name
