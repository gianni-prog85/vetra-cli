/** Ids, descriptions and input schemas of the project-host commands (see ../spec/meta.ts). */
import { z } from "zod";

export const projectHostsListMeta = {
  id: "project-hosts",
  description:
    "List the project's own hosts (its hosts/ folder) and which of them run",
  inputSchema: z.object({}),
};

export const projectHostStartMeta = {
  id: "project-host-start",
  description:
    "Start one of the project's hosts (ph run <host> dev) on the project's own stores; idempotent",
  inputSchema: z.object({
    host: z.string().describe("The host's folder under hosts/"),
  }),
};

export const projectHostStopMeta = {
  id: "project-host-stop",
  description:
    "Ask one of the project's running hosts to stop (it shuts down its stack and closes its stores)",
  inputSchema: z.object({
    host: z.string().describe("The host's folder under hosts/"),
  }),
};
