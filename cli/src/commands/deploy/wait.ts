import { defineCommand } from "../../framework.js";
import { deployEnvironmentWaitMeta } from "./meta.js";
import { findMyEnvironment } from "../../cloud/environments-read.js";
import { loadEnvironmentState } from "../../cloud/environments-write.js";
import {
  describeEnvironmentSummary,
  describeServiceLinks,
  resolveEnvironment,
} from "./_helpers.js";

// Statuses that mean a deploy is still progressing; anything else is settled.
// Compared upper-cased, which also normalizes the model's DEPLOYMENt_FAILED typo.
const IN_FLIGHT = new Set([
  "CHANGES_PENDING",
  "CHANGES_APPROVED",
  "CHANGES_PUSHED",
  "DEPLOYING",
  "TERMINATING",
]);

const POLL_INTERVAL_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const deployEnvironmentWait = defineCommand({
  ...deployEnvironmentWaitMeta,
  execute: async (input, { workdir, config }) => {
    const ctx = { workdir, config };
    let env = await resolveEnvironment(ctx, input.name);
    const deadline = Date.now() + input.timeout * 1000;
    for (;;) {
      const status = (env.status ?? "").toUpperCase();
      if (!IN_FLIGHT.has(status)) {
        if (status === "READY") {
          // Pull the document so we can quote the real service links rather than
          // letting the caller hand-build hosts (and get the format wrong).
          const state = await loadEnvironmentState(ctx, env.id).catch(() => null);
          const links = state ? describeServiceLinks(state) : null;
          return {
            text:
              `Deploy complete — environment is READY.\n` +
              describeEnvironmentSummary(env) +
              (links ? `\nlinks:\n${links}` : ""),
          };
        }
        return {
          text: `Environment settled in ${env.status ?? "unknown"} (not READY).\n${describeEnvironmentSummary(env)}`,
        };
      }
      if (Date.now() >= deadline) {
        return {
          text:
            `Still deploying after ${input.timeout}s (status ${env.status}). ` +
            `Call deploy-environment-wait again to keep waiting.\n` +
            describeEnvironmentSummary(env),
        };
      }
      await sleep(POLL_INTERVAL_MS);
      // Tolerate a transient miss (network blip / momentary absence): keep last-known.
      const next = await findMyEnvironment(ctx, env.id).catch(() => undefined);
      if (next) env = next;
    }
  },
});
