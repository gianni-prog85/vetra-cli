import { useFileNodesInSelectedDrive } from "@powerhousedao/reactor-browser";
import { useMemo } from "react";
import { specDocuments, type ProjectDocument } from "./projects.js";

/** The project's spec documents from the selected drive's nodes, memoized per
 * snapshot. Returns [] while the drive is still hydrating. */
export function useSpecDocuments(): ProjectDocument[] {
  const files = useFileNodesInSelectedDrive();
  return useMemo(() => specDocuments(files ?? []), [files]);
}
