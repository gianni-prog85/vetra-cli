/**
 * Resolve a `PreviewTarget` → live state + URL, reactively.
 *
 *   1. On `target` change (or initial mount), fetch `/resolve`.
 *   2. Subscribe to the preview-server SSE stream. On any reactor-project
 *      event, refetch `/resolve` for the current target.
 *   3. When state is `project-stopped`, fire `POST /start` exactly once per
 *      target — the editor never asks the user; we treat opening a preview
 *      as intent to run the project. `preview-off` (the Studio's project run
 *      is off) starts nothing.
 *   4. Aborts in-flight fetches when target changes or the component
 *      unmounts.
 *
 * Output mirrors the server's `ResolveResult` shape so the consuming
 * component renders the state machine directly.
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchResolve,
  fetchStart,
  subscribePreviewEvents,
  type ResolveResult,
} from "./preview-server-client.js";
import type { PreviewTarget } from "./useSessionPreviewTarget.js";

export type ResolvedPreview =
  | { kind: "no-target" }
  | { kind: "loading" }
  | { kind: "unknown-project"; error: string }
  | { kind: "project-stopped" }
  | { kind: "preview-off" }
  | { kind: "starting"; driveId?: string }
  | {
      kind: "ready";
      driveId: string;
      documentId: string;
      url: string;
    }
  | { kind: "error"; message: string };

export function useResolvedPreview(
  target: PreviewTarget | undefined,
  /** False: never POST /start (a home view only shows a project that is up). */
  { autoStart = true }: { autoStart?: boolean } = {},
): ResolvedPreview {
  const [state, setState] = useState<ResolvedPreview>(
    target ? { kind: "loading" } : { kind: "no-target" },
  );

  /* Whether this lifecycle already auto-started the project. Reset when the
   * target goes away, and on `ready` so a future stop/start cycle doesn't get
   * suppressed. */
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!target) {
      setState({ kind: "no-target" });
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    const refresh = async () => {
      try {
        const r: ResolveResult = await fetchResolve({
          doc: target.doc ?? "",
          drive: target.drive,
          home: target.home,
          signal: ac.signal,
        });
        if (cancelled) return;
        setState(r);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    setState({ kind: "loading" });
    void refresh();

    const unsubscribe = subscribePreviewEvents(() => {
      // Any reactor-project event → re-resolve. Cheap; same loopback hop.
      void refresh();
    });

    return () => {
      cancelled = true;
      ac.abort();
      unsubscribe();
    };
  }, [target?.doc, target?.drive, target?.home]);

  /* Auto-start: when we land on `project-stopped` and haven't started the
   * project yet, fire POST /start. The server is idempotent and the SSE
   * stream will deliver the resulting service:starting / service:ready
   * events, which our refresh subscriber turns into state transitions. */
  const hasTarget = target !== undefined;
  useEffect(() => {
    if (!hasTarget) {
      autoStarted.current = false;
      return;
    }
    if (state.kind === "ready") {
      // Reset so a future stop can be auto-recovered.
      autoStarted.current = false;
      return;
    }
    if (state.kind !== "project-stopped") return;
    if (!autoStart) return;
    if (autoStarted.current) return;

    autoStarted.current = true;
    const ac = new AbortController();
    void fetchStart({ signal: ac.signal }).catch(() => {
      // Errors surface via the next /resolve; nothing to do here.
    });
    return () => ac.abort();
  }, [state.kind, hasTarget, autoStart]);

  return state;
}
