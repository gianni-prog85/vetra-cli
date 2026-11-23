#!/usr/bin/env node
// `pnpm dev`: the Cli from source, as bin/vetra.mjs runs the built one. A
// command that needs the reactor or the agent runs in the Studio that runs
// for its project (found through its run record). With
// VETRA_SWITCHBOARD_URL (<switchboard>/d/<slug>) or --local the command
// attaches to the drive in this process instead; the other commands run here.
// ./cli first: its startup guards run before the runner's import graph.
import { cli, ensureModelAuth, studioRun } from '../index.js';
import { runCli } from '@powerhousedao/clint/cli-runner';

await ensureModelAuth(process.argv);

const argv = process.argv.slice(2);
process.exit(await runCli(cli, { ...studioRun(argv), argv }));
