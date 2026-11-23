#!/usr/bin/env node
// The `vetra` bin: the built ./cli in this terminal. A command that needs
// the reactor or the agent runs in the Studio that runs for its project
// (`ph vetra`, found through its run record): this process sends it there
// and shows its output. With VETRA_SWITCHBOARD_URL (<switchboard>/d/<slug>)
// or --local the command attaches to the drive in this process instead; the
// other commands run here.
// ./cli first: its startup guards run before the runner's import graph.
import { cli, ensureModelAuth, studioRun } from "../dist/node/cli/index.mjs";
import process from "node:process";
import { runCli } from "@powerhousedao/clint/cli-runner";

await ensureModelAuth(process.argv);

const argv = process.argv.slice(2);
process.exit(await runCli(cli, { ...studioRun(argv), argv }));
