import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { describeEnvironmentState } from "./_helpers.js";
import { createCloudEnvironment } from "../../cloud/environments-write.js";
import { deployEnvironmentCreateMeta } from "./meta.js";

export const deployEnvironmentCreate = defineCommand({
  ...deployEnvironmentCreateMeta,
  execute: async (input, { workdir, config }) => {
    requireOption(input.name, "name", "The environment needs a display name.");
    const { id, state } = await createCloudEnvironment(
      { workdir, config },
      { label: input.name, services: input.services, version: input.version },
    );
    return {
      text: `Created environment "${state.label ?? input.name}"  id: ${id}  status: ${state.status}\n${describeEnvironmentState(
        state,
        id,
      )}`,
    };
  },
});
