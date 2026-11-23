import { defineCommand } from "../../framework.js";
import { getAuthState } from "../../auth/renown.js";
import { resolveCloudConfig } from "../../cloud/config.js";
import { whoamiMeta } from "./meta.js";

export const whoami = defineCommand({
  ...whoamiMeta,
  execute: async (_input, { workdir, config }) => {
    const { renownUrl } = resolveCloudConfig(config);
    const state = await getAuthState(workdir, renownUrl);
    if (state.authenticated) {
      return {
        text: `Authorized to act as the user via Renown (${state.address}).`,
      };
    }
    return {
      text: "Not authorized — the user hasn't connected their Renown identity to you yet. Ask the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry. There is no sign-in tool — you cannot authorize yourself.",
    };
  },
});
