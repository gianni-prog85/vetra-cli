/**
 * Preview mode of the Test / Preview panel: the project's own hosts, one
 * chosen, with its start and stop, its status, the links its run gives and a
 * frame on its web address. A host that runs in a terminal shows its command.
 */
import { useState } from "react";
import type { ProjectHost } from "../hooks/preview-server-client.js";
import { useProjectHosts, type ProjectHostsHandle } from "./useProjectHosts.js";

export const HOSTS_LOADING = "Reading the project's hosts…";
export const HOSTS_NONE = "This project has no hosts to preview.";
export const HOSTS_UNKNOWN_PROJECT =
  "The Studio does not run in a Reactor Package project.";
export const HOST_STOPPED = "This host is not running.";
export const HOST_STARTING = "This host is starting…";
export const HOST_STOPPING = "This host is stopping…";
export const HOST_FAILED = "This host failed to start.";
export const HOST_NO_WEB =
  "This host is running. It serves no web app to show here.";
export const HOST_TERMINAL =
  "This host runs in a terminal, not in this panel. Start it from the project folder:";
export const PREVIEW_FRAME_TITLE = "Preview: the project's host";

const STATE_WORD: Record<ProjectHost["state"]["kind"], string> = {
  stopped: "stopped",
  starting: "starting…",
  stopping: "stopping…",
  running: "running",
  failed: "failed",
};

/** The host shown when none was picked: a running web app first. */
function defaultHost(hosts: ProjectHost[]): ProjectHost | undefined {
  return (
    hosts.find((h) => h.state.kind === "running" && h.state.webUrl) ??
    hosts.find(
      (h) => h.state.kind === "running" || h.state.kind === "starting",
    ) ??
    hosts.find((h) => h.startable && h.runner.endsWith("/runners/connect")) ??
    hosts.find((h) => h.startable) ??
    hosts[0]
  );
}

function Message({
  state,
  title,
  children,
}: {
  state: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-preview-state={state}
      className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
    >
      <p className="font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}

function CommandCard({ host }: { host: ProjectHost }) {
  const [copied, setCopied] = useState(false);
  return (
    <Message state="terminal" title={`Run the ${host.host} host`}>
      <p className="max-w-xl">{HOST_TERMINAL}</p>
      <div className="flex items-center gap-2">
        <code
          data-host-command
          className="rounded border border-border bg-card px-2 py-1 font-mono text-xs text-foreground"
        >
          {host.command}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(host.command)
              .then(() => setCopied(true));
          }}
          className="h-7 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Message>
  );
}

function HostBody({ host, frameKey }: { host: ProjectHost; frameKey: number }) {
  const { state } = host;
  if (!host.startable && state.kind !== "running") {
    if (state.kind === "failed") {
      return (
        <Message state="failed" title={HOST_FAILED}>
          <p className="max-w-xl whitespace-pre-wrap break-words">
            {state.reason}
          </p>
        </Message>
      );
    }
    return <CommandCard host={host} />;
  }
  if (state.kind === "running") {
    if (state.webUrl) {
      return (
        <iframe
          key={frameKey}
          data-preview-frame
          title={PREVIEW_FRAME_TITLE}
          src={state.webUrl}
          className="h-full w-full border-0 bg-background"
        />
      );
    }
    return <Message state="running" title={HOST_NO_WEB} />;
  }
  if (state.kind === "failed") {
    return (
      <Message state="failed" title={HOST_FAILED}>
        <p className="max-w-xl whitespace-pre-wrap break-words">
          {state.reason}
        </p>
        {state.logFile ? (
          <p className="max-w-xl break-all font-mono text-xs">
            {state.logFile}
          </p>
        ) : null}
      </Message>
    );
  }
  return (
    <Message
      state={state.kind}
      title={
        state.kind === "starting"
          ? HOST_STARTING
          : state.kind === "stopping"
            ? HOST_STOPPING
            : HOST_STOPPED
      }
    />
  );
}

const BUTTON =
  "h-6 rounded-md border px-2.5 text-xs font-medium disabled:opacity-50";

export function PreviewHostsView({ hosts }: { hosts: ProjectHostsHandle }) {
  const { view, pending, actionError, start, stop } = hosts;
  const [picked, setPicked] = useState<string>();
  const [frameKey, setFrameKey] = useState(0);

  if (view.kind === "loading") {
    return <Message state="loading" title={HOSTS_LOADING} />;
  }
  if (view.kind === "none") {
    return (
      <Message state="none" title={HOSTS_NONE}>
        <p className="max-w-xl">{view.reason}</p>
      </Message>
    );
  }
  if (view.kind === "unknown-project") {
    return <Message state="unavailable" title={HOSTS_UNKNOWN_PROJECT} />;
  }
  if (view.kind === "refused") {
    return <Message state="refused" title={view.error} />;
  }

  const host =
    view.hosts.find((h) => h.host === picked) ?? defaultHost(view.hosts);
  if (!host) return <Message state="none" title={HOSTS_NONE} />;
  const { state } = host;
  const running = state.kind === "running";
  const sending = pending === host.host;
  const webUrl = running ? state.webUrl : undefined;

  return (
    <div data-preview-hosts className="flex h-full flex-col">
      <div
        role="group"
        aria-label="Host"
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-card px-3 py-1.5"
      >
        <span className="text-xs text-muted-foreground">Host</span>
        {view.hosts.map((h) => (
          <button
            key={h.host}
            type="button"
            data-host={h.host}
            data-host-state={h.state.kind}
            aria-pressed={h.host === host.host}
            onClick={() => setPicked(h.host)}
            className={`flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${
              h.host === host.host
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground hover:bg-accent"
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                h.state.kind === "running"
                  ? "bg-green-500"
                  : h.state.kind === "failed"
                    ? "bg-red-500"
                    : h.state.kind === "stopped"
                      ? "bg-muted-foreground/40"
                      : "bg-amber-500"
              }`}
            />
            {h.host}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        <button
          type="button"
          aria-label="Reload the preview"
          title="Reload"
          disabled={!webUrl}
          onClick={() => setFrameKey((k) => k + 1)}
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          ↻
        </button>
        {host.startable || running ? (
          running || state.kind === "starting" ? (
            <button
              type="button"
              data-host-stop
              disabled={sending}
              onClick={() => stop(host.host)}
              className={`${BUTTON} border-border bg-card text-foreground hover:bg-accent`}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              data-host-start
              disabled={sending || state.kind === "stopping"}
              onClick={() => start(host.host)}
              className={`${BUTTON} border-foreground bg-foreground text-background`}
            >
              Start
            </button>
          )
        ) : null}
        <span
          data-host-status={state.kind}
          className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
        >
          {host.host} · {STATE_WORD[state.kind]}
        </span>
        <div
          data-host-address
          className="min-w-0 flex-1 truncate rounded border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground"
        >
          {webUrl ?? host.command}
        </div>
        {webUrl ? (
          <a
            href={webUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the preview in its own tab"
            title="Open in its own tab"
            className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ↗
          </a>
        ) : null}
      </div>

      {running && state.links.length > 0 ? (
        <ul
          data-host-links
          className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 border-b border-border bg-card px-3 py-1 text-xs"
        >
          {state.links.map((link) => (
            <li key={`${link.name} ${link.url}`} className="min-w-0 truncate">
              <span className="text-muted-foreground">{link.name} </span>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-foreground underline-offset-2 hover:underline"
              >
                {link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          data-host-action-error
          className="shrink-0 border-b border-border bg-card px-3 py-1 text-xs text-red-600"
        >
          {actionError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        <HostBody host={host} frameKey={frameKey} />
      </div>
    </div>
  );
}

export function PreviewHosts() {
  return <PreviewHostsView hosts={useProjectHosts()} />;
}
