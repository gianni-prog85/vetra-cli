#!/usr/bin/env node
// `pnpm dev`: the Cli from source, as bin/vetra.mjs runs the built one. A
// command attaches to the Studio drive of the Studio that runs for its
// project (found through its run record), or to the drive
// VETRA_SWITCHBOARD_URL names (<switchboard>/d/<slug>); with neither,
// commands that need no reactor run.
// ./cli first: its startup guards run before the runner's import graph.
import { cli, ensureModelAuth, studioDriveUrl } from '../index.js';
import { runCli } from '@powerhousedao/clint/cli-runner';

await ensureModelAuth(process.argv);

const argv = process.argv.slice(2);
process.exit(await runCli(cli, { url: studioDriveUrl(argv), argv }));
