# Repository Guidelines

## Project Structure & Module Organization
This repository is split into two TypeScript packages plus docs and marketing assets. `src/` contains the CLI and Ink TUI app; primary code lives under `src/src/` with folders such as `cli/`, `ui/`, `agents/`, `provider/`, `session/`, and `mcp/`. Build output is written to `src/dist/` and executable entrypoints live in `src/bin/`. `bridge/` contains the VS Code extension that exposes the Copilot bridge API, with source in `bridge/src/` and compiled output in `bridge/dist/`. `docs/` holds localized READMEs, `web/` contains the landing page, and `scripts/` contains install helpers.

## Build, Test, and Development Commands
Install dependencies in the package you are changing.

- `cd src && npm install && npm run build`: bundle the CLI with esbuild.
- `cd src && npm run typecheck`: run strict TypeScript checks without emitting files.
- `cd src && npm run start`: launch the local CLI entrypoint.
- `cd src && npm test`: run the Bun test command for the CLI package.
- `cd bridge && npm install && npm run compile`: build the VS Code bridge extension.
- `cd bridge && npm run watch`: rebuild the extension on file changes.
- `./scripts/setup.sh`: bootstrap the project for manual local development.

## Coding Style & Naming Conventions
Follow the existing TypeScript style: 2-space indentation, semicolons, single quotes, and named exports where practical. Use `PascalCase` for React components and types, `camelCase` for functions and variables, and kebab-case for file names that are not React components, for example `session-manager.ts`. Keep generated files in `dist/` out of manual edits. Prefer small modules under the existing domain folders instead of adding new top-level directories.

## Testing Guidelines
There are currently no committed test files, so every change should at minimum pass `cd src && npm run typecheck` and the relevant build command. For CLI tests, add `*.test.ts` files alongside the related module or under a future `src/test/` directory so they can run under `bun test`. For bridge changes, verify the extension compiles and smoke-test the main VS Code commands manually.

## Commit & Pull Request Guidelines
Recent history favors concise, Conventional Commit style subjects such as `feat: parallel tool execution` and `fix: resolve postinstall cwd error`. Keep commits focused and imperative. Pull requests should include a short problem statement, implementation summary, manual verification steps, and screenshots or terminal captures for UI-facing changes. Link related issues when applicable.
