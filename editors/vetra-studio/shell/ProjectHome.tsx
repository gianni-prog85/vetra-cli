/**
 * The project home (C1): what a Studio inside one project shows in place of
 * the idea screen. The project's name and version (its package.json, read by
 * the local API), the conversations with the agent, and the specifications
 * in the Studio drive (read-only). Studio creates no project and starts no
 * product here: a new app starts with `ph init`, then Studio in it.
 */
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { useState } from "react";
import { ChatPane } from "../ChatPane.js";
import { useStudioSignIn } from "../idea/useStudioSignIn.js";
import {
  PROJECT_FALLBACK_NAME,
  specDocuments,
  SPECIFY_TYPES,
} from "../specify/projects.js";
import { AccountMenu } from "./AccountMenu.js";
import { useProjectPackage } from "./useProjectPackage.js";

export const NO_SPECS =
  "No specifications yet. Ask the agent for a document model, an editor or an app.";

export function ProjectHome({
  drive,
  dispatch,
  onOpenSettings,
}: {
  drive: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  onOpenSettings: () => void;
}) {
  const project = useProjectPackage();
  const auth = useStudioSignIn();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const files = drive.state.global.nodes.filter(
    (n): n is FileNode => n.kind === "file",
  );
  const specs = specDocuments(files);

  return (
    <div className="flex h-full w-full flex-col">
      <header
        aria-label="Project"
        className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-6 py-3"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
            {project?.name ?? PROJECT_FALLBACK_NAME}
          </h1>
          {project?.version ? (
            <span
              data-project-version
              className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground"
            >
              {project.version}
            </span>
          ) : null}
        </div>
        <AccountMenu
          name={auth.name}
          hasUser={auth.hasUser}
          onSignIn={auth.signIn}
          onSignOut={auth.signOut}
          onOpenSettings={onOpenSettings}
        />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="Conversations"
          className="flex w-[38%] min-w-[18rem] shrink-0 flex-col border-r border-border bg-card"
        >
          <ChatPane
            document={drive}
            dispatch={dispatch}
            selectedSessionId={sessionId}
            onSelectSession={setSessionId}
            driveLoaded={true}
          />
        </aside>
        <main
          aria-label="Specifications"
          className="min-h-0 flex-1 overflow-y-auto bg-background px-8 py-6"
        >
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Specifications
          </h2>
          {specs.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{NO_SPECS}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/40 rounded-lg border border-border bg-card">
              {specs.map((spec) => (
                <li
                  key={spec.id}
                  data-spec={spec.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {spec.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {SPECIFY_TYPES.get(spec.documentType) ?? spec.documentType}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}
