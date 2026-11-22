import { useEffect, useState } from "react";
import { fetchReleaseStatus } from "../hooks/preview-server-client.js";

/** The project's release status. `known: false` when it can't be determined
 * (registry unreachable, auth required, no package) — the UI shows nothing. */
export type ReleaseStatus =
  | {
      known: true;
      upToDate: boolean;
      needsRelease: boolean;
      localVersion: string | null;
      publishedVersion: string | null;
    }
  | { known: false };

export type ReleaseStatusState =
  { status: "loading" } | { status: "ready"; release: ReleaseStatus };

const UNKNOWN: ReleaseStatus = { known: false };

/**
 * The release status of the project the Studio runs in, read again whenever
 * `reloadNonce` changes (after a deploy). A failed read is an unknown status.
 */
export function useReleaseStatus(reloadNonce = 0): ReleaseStatusState {
  const [state, setState] = useState<ReleaseStatusState>({
    status: "loading",
  });

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    fetchReleaseStatus({ signal: ac.signal }).then(
      (r) => {
        if (ac.signal.aborted) return;
        setState({
          status: "ready",
          release:
            r.kind === "ok"
              ? {
                  known: true,
                  upToDate: r.upToDate,
                  needsRelease: r.needsRelease,
                  localVersion: r.localVersion,
                  publishedVersion: r.publishedVersion,
                }
              : UNKNOWN,
        });
      },
      () => {
        if (ac.signal.aborted) return;
        setState({ status: "ready", release: UNKNOWN });
      },
    );
    return () => ac.abort();
  }, [reloadNonce]);

  return state;
}
