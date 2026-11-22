/**
 * The project's name and version, from its package.json through the local
 * API (`GET /project-package`, the workdir itself). Undefined until read, or
 * when it can't be read; read again when the local API becomes known.
 */
import { useEffect, useState } from "react";
import {
  fetchProjectPackage,
  subscribePreviewEvents,
} from "../hooks/preview-server-client.js";

export interface ProjectPackage {
  name: string;
  version: string;
}

export function useProjectPackage(): ProjectPackage | undefined {
  const [project, setProject] = useState<ProjectPackage | undefined>();

  useEffect(() => {
    if (project) return;
    const ac = new AbortController();
    const read = () => {
      fetchProjectPackage({ signal: ac.signal }).then(
        (result) => {
          if (result.kind === "ok") {
            setProject({ name: result.name, version: result.version });
          }
        },
        () => {
          // Not reachable yet: the next event reads again.
        },
      );
    };
    read();
    // The local API's events stream opens once the tab knows its address.
    const unsubscribe = subscribePreviewEvents(read);
    return () => {
      ac.abort();
      unsubscribe();
    };
  }, [project]);

  return project;
}
