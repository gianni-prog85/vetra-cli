import {
  useSelectedDrive,
  useSetPHAppConfig,
} from "@powerhousedao/reactor-browser";
import type { ReactNode } from "react";
import { editorConfig } from "./config.js";
import { StudioShell } from "./shell/StudioShell.js";

/** `children` is the open document's editor (Connect's route outlet). */
export default function Editor({ children }: { children?: ReactNode }) {
  useSetPHAppConfig(editorConfig);
  const [document, dispatch] = useSelectedDrive();
  return (
    <StudioShell document={document} dispatch={dispatch}>
      {children}
    </StudioShell>
  );
}
