import { defineCommand } from "../../framework.js";
import {
  describeEnvironmentState,
  parsePackageSpec,
  resolveEnvironment,
} from "./_helpers.js";
import { applyEnvironmentUpdate } from "../../cloud/environments-write.js";
import { deployEnvironmentUpdateMeta } from "./meta.js";

export const deployEnvironmentUpdate = defineCommand({
  ...deployEnvironmentUpdateMeta,
  execute: async (input, { workdir, config }) => {
    const ctx = { workdir, config };
    const env = await resolveEnvironment(ctx, input.name);
    const state = await applyEnvironmentUpdate(ctx, env.id, {
      label: input.label,
      transition: input.transition,
      enableServices: input.enableService,
      disableServices: input.disableService,
      addPackages: input.addPackage?.map(parsePackageSpec),
      removePackages: input.removePackage,
    });
    return {
      text: `Updated environment "${state.label ?? env.id}" (${env.id}).\n${describeEnvironmentState(
        state,
        env.id,
      )}`,
    };
  },
});
