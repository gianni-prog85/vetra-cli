#!/usr/bin/env node
// The `vetra` bin: the built ./cli in this terminal. It attaches to the
// switchboard drive VETRA_SWITCHBOARD_URL names (<switchboard>/d/<slug>);
// without it, commands that need no reactor run.
// ./cli first: its startup guards run before the runner's import graph.
import { cli, ensureModelAuth } from "../dist/node/cli/index.mjs";
import process from "node:process";
import { runCli } from "@powerhousedao/clint/cli-runner";

await ensureModelAuth(process.argv);

process.exit(
  await runCli(cli, {
    url: process.env.VETRA_SWITCHBOARD_URL,
    argv: process.argv.slice(2),
  }),
);
