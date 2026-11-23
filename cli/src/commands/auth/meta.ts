/** Id, description and input schema of the auth commands (see ../spec/meta.ts). */
import { z } from "zod";

export const whoamiMeta = {
  id: "whoami",
  description:
    "Check whether you (the agent) are authorized to act as the user via their Renown identity. Renown is the identity/auth provider — the same authorization lets you act as the user across Vetra Cloud and other Renown-protected services. Read-only — you cannot sign in yourself. If not authorized, tell the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry.",
  inputSchema: z.object({}),
};
