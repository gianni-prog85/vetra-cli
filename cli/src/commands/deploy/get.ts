import { defineCommand } from "../../framework.js";
import { renderProjected } from "../spec/_helpers.js";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  findMyEnvironment,
  listMyEnvironments,
} from "../../cloud/environments-read.js";
import { loadEnvironmentState } from "../../cloud/environments-write.js";
import { isStudioEnvironment } from "../../../../cloud-client/index.js";
import {
  describeEnvironmentState,
  describeEnvironmentSummary,
} from "./_helpers.js";
import { deployEnvironmentGetMeta } from "./meta.js";

export const deployEnvironmentGet = defineCommand({
  ...deployEnvironmentGetMeta,
  execute: async (input, { workdir, config }) => {
    requireOption(
      input.name,
      "name",
      "Pass an environment id, name, or subdomain (see deploy-environment-list).",
    );
    const ctx = { workdir, config };
    const env = await findMyEnvironment(ctx, input.name);
    if (!env) {
      const candidates = (await listMyEnvironments(ctx, "MINE"))
        .flatMap((e) => [e.name ?? "", e.subdomain ?? ""])
        .filter(Boolean);
      throw unknownValueError({
        subject: "environment",
        value: input.name,
        candidates,
        knownLabel: "Available environments",
      });
    }

    // The summary (myEnvironments) carries no packages/services, so pull the
    // full document. Fall back to the summary if the pull fails (e.g. the
    // document can't be loaded) so a get never hard-fails.
    const state = await loadEnvironmentState(ctx, env.id).catch(() => null);

    if (input.full || input.filter) {
      // Project over the full state (so `$.packages`, `$.services` resolve),
      // keeping the document id the summary carried.
      const obj = state ? { ...state, id: env.id } : env;
      return { text: renderProjected(obj, input.filter ?? "$", input.format) };
    }
    const studioNote =
      state && isStudioEnvironment(state.packages.map((p) => p.name))
        ? "\n\nVetra Studio environment (not a deploy target). Do not install " +
          "project packages here; deploy to a separate environment."
        : "";
    return {
      text:
        (state
          ? describeEnvironmentState(state, env.id)
          : describeEnvironmentSummary(env)) + studioNote,
    };
  },
});
