import { useEffect, useState } from "react";
import { fetchProjectPackage } from "../hooks/preview-server-client.js";
import { errorMessage } from "./utils.js";

export type ProjectPackageInfo = { name: string; version: string };

export type ProjectPackageState =
  | { status: "loading" }
  /** `info` is null when the project has no readable package. */
  | { status: "ready"; info: ProjectPackageInfo | null }
  | { status: "error"; message: string };

/**
 * The package.json name + version of the project the Studio runs in, read
 * again whenever `reloadNonce` changes (after a deploy).
 */
export function useProjectPackageInfo(reloadNonce = 0): ProjectPackageState {
  const [state, setState] = useState<ProjectPackageState>({
    status: "loading",
  });

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    fetchProjectPackage({ signal: ac.signal }).then(
      (r) => {
        if (ac.signal.aborted) return;
        setState({
          status: "ready",
          info: r.kind === "ok" ? { name: r.name, version: r.version } : null,
        });
      },
      (err: unknown) => {
        if (ac.signal.aborted) return;
        setState({ status: "error", message: errorMessage(err) });
      },
    );
    return () => ac.abort();
  }, [reloadNonce]);

  return state;
}
