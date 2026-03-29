#!/usr/bin/env node
import { createCli } from './cli/cli-program';

const program = createCli();
program.parse(process.argv);
