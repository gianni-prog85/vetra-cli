import { z } from "zod";
import { processControlChannel } from "@powerhousedao/host-core";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  localProjectHosts,
  remoteProjectHosts,
  type ProjectHostsApi,
} from "../../project-hosts/control.js";
import {
  projectHosts,
  type ProjectHost,
  type ProjectHostActionResult,
} from "../../project-hosts/manager.js";

/** Where a host this command starts would keep running. */
type Place = "here" | "beside" | "alone";

async function hostsOf(context: {
  workdir: string;
  serving?: Parameters<typeof remoteProjectHosts>[0];
}): Promise<{ api: ProjectHostsApi; place: Place }> {
  if (context.serving) {
    return { api: remoteProjectHosts(context.serving), place: "beside" };
  }
  const projectPath = await projectRoot(context.workdir);
  return {
    api: localProjectHosts(projectHosts(), projectPath),
    // The running Cli has a channel; a command that ends has none.
    place: processControlChannel() ? "here" : "alone",
  };
}

export function formatProjectHost(host: ProjectHost): string {
  const { state } = host;
  const head = `${state.kind === "running" ? "●" : "○"} ${host.host} [${state.kind}]`;
  if (state.kind === "running") {
    const links = state.links.map((l) => `    ${l.name}: ${l.url}`);
    return [`${head} pid ${state.pid}`, ...links].join("\n");
  }
  if (state.kind === "failed") return `${head} ${state.reason}`;
  return host.startable ? head : `${head} terminal: ${host.command}`;
}

function report(result: ProjectHostActionResult) {
  if (result.kind === "ok") {
    return { text: formatProjectHost(result.host), data: result.host };
  }
  throw new Error(result.error);
}

export const projectHostsList = defineCommand({
  id: "project-hosts",
  description:
    "List the project's own hosts (its hosts/ folder) and which of them run",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const { api } = await hostsOf(context);
    const result = await api.list();
    if (result.kind === "none") return { text: result.reason, data: result };
    return {
      text: result.hosts.map(formatProjectHost).join("\n"),
      data: result,
    };
  },
});

export const projectHostStart = defineCommand({
  id: "project-host-start",
  description:
    "Start one of the project's hosts (ph run <host> dev) on the project's own stores; idempotent",
  inputSchema: z.object({
    host: z.string().describe("The host's folder under hosts/"),
  }),
  execute: async ({ host }, context) => {
    const { api, place } = await hostsOf(context);
    if (place === "alone") {
      throw new Error(
        `${host} was not started: a host started here runs as long as the Studio that started it, and this command ends. ` +
          "Start the Studio where it keeps running (`ph run @powerhousedao/vetra-cli/studio`), then run this command from a second terminal; " +
          `or run the host itself: \`ph run ${host} dev\`.`,
      );
    }
    return report(await api.start(host));
  },
});

export const projectHostStop = defineCommand({
  id: "project-host-stop",
  description:
    "Ask one of the project's running hosts to stop (it shuts down its stack and closes its stores)",
  inputSchema: z.object({
    host: z.string().describe("The host's folder under hosts/"),
  }),
  execute: async ({ host }, context) => {
    const { api } = await hostsOf(context);
    return report(await api.stop(host));
  },
});

export const projectHostCommands = [
  projectHostsList,
  projectHostStart,
  projectHostStop,
];
