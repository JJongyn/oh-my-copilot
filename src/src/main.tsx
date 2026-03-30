#!/usr/bin/env node
import { createCli } from './cli/cli-program';

const program = createCli();

function shouldInjectDefaultChat(argv: string[], commandNames: Set<string>): boolean {
  const args = argv.slice(2);
  if (args.length === 0) return true;

  for (const arg of args) {
    if (arg === '-h' || arg === '--help' || arg === '-V' || arg === '--version') {
      return false;
    }
    if (arg.startsWith('-')) continue;
    if (commandNames.has(arg)) return false;
    return false;
  }

  return true;
}

const commandNames = new Set(program.commands.map(command => command.name()));
const argv = shouldInjectDefaultChat(process.argv, commandNames)
  ? [...process.argv.slice(0, 2), 'chat', ...process.argv.slice(2)]
  : process.argv;

program.parse(argv);
