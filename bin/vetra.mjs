#!/usr/bin/env node
// The `vetra` bin: the built ./cli in this terminal. A command attaches to
// the Studio drive of the Studio that runs for its project (`ph vetra`, found
// through its run record), or to the drive VETRA_SWITCHBOARD_URL names
// (<switchboard>/d/<slug>); with neither, commands that need no reactor run.
// ./cli first: its startup guards run before the runner's import graph.
import {
  cli,
  ensureModelAuth,
  studioDriveUrl,
} from "../dist/node/cli/index.mjs";
import process from "node:process";
import { runCli } from "@powerhousedao/clint/cli-runner";

await ensureModelAuth(process.argv);

const argv = process.argv.slice(2);
process.exit(await runCli(cli, { url: studioDriveUrl(argv), argv }));
