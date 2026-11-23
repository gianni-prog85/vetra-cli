/**
 * The project hosts over the running Cli's control channel: a command typed
 * in a second terminal reaches the hosts the running Cli started. The
 * project is the running Cli's own (its workdir).
 */
import {
  callControl,
  type ControlChannel,
  type ControlRecord,
} from "@powerhousedao/host-core";
import type {
  ProjectHostActionResult,
  ProjectHosts,
  ProjectHostsResult,
} from "./manager.js";

export const HOSTS_LIST = "project-hosts.list";
export const HOSTS_START = "project-hosts.start";
export const HOSTS_STOP = "project-hosts.stop";

/** What the commands and the local API act through. */
export interface ProjectHostsApi {
  list(): Promise<ProjectHostsResult>;
  /** Resolves when the host runs or its start has failed. */
  start(host: string): Promise<ProjectHostActionResult>;
  stop(host: string): Promise<ProjectHostActionResult>;
}

function hostParam(params: unknown): string {
  const host = (params as { host?: unknown } | undefined)?.host;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("Name the host: { host }.");
  }
  return host;
}

/** The hosts of `projectPath`, in this process. */
export function localProjectHosts(
  hosts: ProjectHosts,
  projectPath: string,
): ProjectHostsApi {
  return {
    list: () => hosts.list(projectPath),
    async start(host) {
      const { result, settled } = await hosts.start(projectPath, host);
      if (result.kind !== "ok") return result;
      await settled;
      const after = await hosts.list(projectPath);
      const now =
        after.kind === "ok" ? after.hosts.find((h) => h.host === host) : undefined;
      if (!now) return result;
      return now.state.kind === "failed"
        ? { kind: "failed", error: now.state.reason, host: now }
        : { kind: "ok", host: now };
    },
    stop: (host) => hosts.stop(projectPath, host),
  };
}

/** Answers the three methods on this process's channel. */
export function serveProjectHosts(
  channel: Pick<ControlChannel, "handle">,
  api: ProjectHostsApi,
): void {
  channel.handle(HOSTS_LIST, () => api.list());
  channel.handle(HOSTS_START, (params) => api.start(hostParam(params)));
  channel.handle(HOSTS_STOP, (params) => api.stop(hostParam(params)));
}

/** The hosts of the Cli that answers on `serving`. */
export function remoteProjectHosts(serving: ControlRecord): ProjectHostsApi {
  return {
    list: () => callControl(serving, HOSTS_LIST) as Promise<ProjectHostsResult>,
    start: (host) =>
      callControl(serving, HOSTS_START, { host }) as Promise<ProjectHostActionResult>,
    stop: (host) =>
      callControl(serving, HOSTS_STOP, { host }) as Promise<ProjectHostActionResult>,
  };
}
