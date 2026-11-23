/**
 * The project's own hosts for the Preview mode of the Test / Preview panel:
 * read through the local API (`GET /hosts`) and again every few seconds,
 * faster while one starts or stops. A start or a stop is followed by a read.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchProjectHostAction,
  fetchProjectHosts,
  type ProjectHostsResult,
} from "../hooks/preview-server-client.js";

export type ProjectHostsView =
  /** Not read yet, or the local API is not known yet. */
  { kind: "loading" } | ProjectHostsResult;

const REREAD_MS = 5_000;
/** While a host starts or stops. */
const BUSY_REREAD_MS = 1_500;

function busy(view: ProjectHostsView): boolean {
  return (
    view.kind === "ok" &&
    view.hosts.some(
      (h) => h.state.kind === "starting" || h.state.kind === "stopping",
    )
  );
}

export interface ProjectHostsHandle {
  view: ProjectHostsView;
  /** The host an action is being sent for. */
  pending: string | undefined;
  /** What the last start or stop answered when it was not done. */
  actionError: string | undefined;
  start: (host: string) => void;
  stop: (host: string) => void;
}

export function useProjectHosts(): ProjectHostsHandle {
  const [view, setView] = useState<ProjectHostsView>({ kind: "loading" });
  const [pending, setPending] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const readRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (next: ProjectHostsView) => {
      clearTimeout(timer);
      timer = setTimeout(read, busy(next) ? BUSY_REREAD_MS : REREAD_MS);
    };
    function read() {
      fetchProjectHosts({ signal: ac.signal }).then(
        (next) => {
          if (ac.signal.aborted) return;
          setView((current) =>
            JSON.stringify(current) === JSON.stringify(next) ? current : next,
          );
          schedule(next);
        },
        () => {
          // Not reachable yet: the next tick reads again.
          if (!ac.signal.aborted) schedule({ kind: "loading" });
        },
      );
    }
    readRef.current = read;
    read();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, []);

  const act = useCallback((action: "start" | "stop", host: string) => {
    setPending(host);
    setActionError(undefined);
    fetchProjectHostAction(action, host)
      .then(
        (result) => {
          if (result.kind !== "ok") setActionError(result.error);
        },
        (err: unknown) =>
          setActionError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        setPending(undefined);
        readRef.current();
      });
    // The start is under way before it answers.
    setTimeout(() => readRef.current(), 300);
  }, []);

  return {
    view,
    pending,
    actionError,
    start: useCallback((host: string) => act("start", host), [act]),
    stop: useCallback((host: string) => act("stop", host), [act]),
  };
}
