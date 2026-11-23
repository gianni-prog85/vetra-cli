/**
 * The Preview Connect on its `preview` drive, for the Test panel: its address
 * once the Preview run is ready, else why it is not there. Read through the
 * local API (`GET /resolve?home=1`, then `GET /preview/status` for the
 * reason) and again on each of the run's lifecycle events.
 */
import { useEffect, useState } from "react";
import {
  fetchPreviewStatus,
  fetchResolve,
  subscribePreviewEvents,
} from "../hooks/preview-server-client.js";

export type PreviewHome =
  /** Not read yet, or the local API is not known yet. */
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "starting" }
  | { kind: "stopped" }
  | { kind: "unavailable"; reason: string; hint?: string }
  | { kind: "failed"; error: string };

/** How often a state that is not final is read again without an event. */
const REREAD_MS = 5_000;

async function readPreviewHome(signal: AbortSignal): Promise<PreviewHome> {
  const resolved = await fetchResolve({ doc: "", home: true, signal });
  if (resolved.kind === "ready") return { kind: "ready", url: resolved.url };
  const status = await fetchPreviewStatus({ signal });
  if (status && status.kind !== "ready") return status;
  if (resolved.kind === "starting" || status?.kind === "ready") {
    return { kind: "starting" };
  }
  if (resolved.kind === "unknown-project") {
    return {
      kind: "unavailable",
      reason: "The Studio does not run in a Reactor Package project.",
    };
  }
  return { kind: "stopped" };
}

function same(a: PreviewHome, b: PreviewHome): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function usePreviewHome(): PreviewHome {
  const [home, setHome] = useState<PreviewHome>({ kind: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    const read = () => {
      readPreviewHome(ac.signal).then(
        (next) => {
          if (ac.signal.aborted) return;
          setHome((current) => (same(current, next) ? current : next));
        },
        () => {
          // Not reachable yet: the next event or tick reads again.
        },
      );
    };
    read();
    const unsubscribe = subscribePreviewEvents(read);
    // The run record's drive follows `service:ready`; a missed event too.
    const timer = setInterval(read, REREAD_MS);
    return () => {
      ac.abort();
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return home;
}
