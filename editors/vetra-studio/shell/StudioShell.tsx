/**
 * The Studio page: a top bar over up to three panels. Specs is the explorer
 * of the specification drive, Test is the Preview Connect in a frame (Preview
 * is not available yet), Agent is the chat. Specs and Test also open in a tab of their own, without the bar;
 * there a spec document is its editor only.
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import {
  VetraExplorer,
  type CreateDocumentInput,
} from "@powerhousedao/vetra/editors/vetra-explorer";
import { useCallback, useState, type ReactNode } from "react";
import { addAgentWritableDocument } from "../addAgentWritableDocument.js";
import { ChatPane } from "../ChatPane.js";
import {
  ProductDebugPanel,
  isProductDebugEnabled,
} from "../debug/ProductDebugPanel.js";
import { useStudioSignIn } from "../idea/useStudioSignIn.js";
import { PublishPermissionModal } from "../permission/PublishPermissionModal.js";
import { SettingsDialog } from "../settings/SettingsDialog.js";
import { PROJECT_FALLBACK_NAME } from "../specify/projects.js";
import { AccountMenu } from "./AccountMenu.js";
import { LABS_SCREENS } from "./labsScreens.js";
import {
  PANELS,
  PANEL_LABELS,
  drivePathOf,
  openCount,
  ownTabHref,
  readPanels,
  tabView,
  togglePanel,
  writePanels,
  type OpenPanels,
  type PanelId,
} from "./panels.js";
import { PreviewHosts } from "./PreviewHosts.js";
import { usePreviewHome } from "./usePreviewHome.js";
import { useProjectPackage } from "./useProjectPackage.js";
import { useStudioState } from "./useStudioState.js";

export const ALL_CLOSED = "All panels are closed";
export const TEST_STARTING = "The Preview is starting…";
export const TEST_STOPPED = "The Preview is not running.";
export const TEST_UNAVAILABLE = "Test is not available for this project.";
export const TEST_FAILED = "The Preview failed to start.";
export const TEST_FRAME_TITLE = "Test: the project on the Preview drive";
const LABS_LINK = "Open in Vetra Labs ↗";

export type StudioShellProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  /** The open document's editor, as Connect hands it to a drive app. */
  children?: ReactNode;
  /** The project's page in Vetra Labs; without it the links are left out. */
  labsUrl?: string;
};

// The Studio page is the whole window; style.css hides Connect's sidebar
// under `.studio-page`. No z-index, so Connect's dialogs (portals on the
// body) stay above it.
const PAGE =
  "studio-page fixed inset-0 flex flex-col overflow-hidden bg-background";

export function StudioShell({
  document,
  dispatch,
  children,
  labsUrl,
}: StudioShellProps) {
  const result = useStudioState(document);
  const project = useProjectPackage();
  const auth = useStudioSignIn();
  const [panels, setPanels] = useState<OpenPanels>(readPanels);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [showDebug] = useState(isProductDebugEnabled);

  const toggle = useCallback((id: PanelId) => {
    setPanels((current) => {
      const next = togglePanel(current, id);
      writePanels(next);
      return next;
    });
  }, []);

  const driveId = document.header.id;
  const createDocument = useCallback(
    ({ name, documentType }: CreateDocumentInput) =>
      addAgentWritableDocument(driveId, name, documentType),
    [driveId],
  );

  if (result.status === "loading") return <ShellLoading />;

  const view = tabView(window.location.search);
  const pathname = window.location.pathname;

  const explorer = (
    <VetraExplorer
      document={document}
      packageName={project?.name}
      pageImages={LABS_SCREENS}
      labsUrl={labsUrl}
      createDocument={createDocument}
    >
      {children}
    </VetraExplorer>
  );

  if (view === "test") {
    return (
      <div data-own-tab="test" className={PAGE}>
        <TestPreview />
      </div>
    );
  }
  if (view === "specs") {
    // A document is its editor only; without one the tab is the explorer.
    return (
      <div data-own-tab="specs" className={PAGE}>
        <div className="min-h-0 flex-1 overflow-auto">
          {children ?? explorer}
        </div>
      </div>
    );
  }

  const sidePanels = panels.specs || panels.test;

  return (
    <div className={PAGE}>
      <header
        aria-label="Vetra Studio"
        className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
      >
        <span className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
          Vetra Studio
        </span>
        <span
          data-project
          className="flex min-w-0 items-baseline gap-1.5 text-sm text-muted-foreground"
        >
          <span data-project-name className="truncate">
            {project?.name ?? PROJECT_FALLBACK_NAME}
          </span>
          {project?.version ? (
            <span data-project-version className="shrink-0 tabular-nums">
              {project.version}
            </span>
          ) : null}
        </span>
        <div
          role="group"
          aria-label="Panels"
          className="ml-auto flex shrink-0 items-center gap-1.5"
        >
          {PANELS.map((id) => (
            <PanelToggle key={id} id={id} open={panels[id]} onToggle={toggle} />
          ))}
        </div>
        {labsUrl ? (
          <a
            href={labsUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {LABS_LINK}
          </a>
        ) : null}
        <AccountMenu
          name={auth.name}
          hasUser={auth.hasUser}
          onSignIn={auth.signIn}
          onSignOut={auth.signOut}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </header>

      {openCount(panels) === 0 ? (
        <div
          data-panels="none"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3"
        >
          <p className="text-sm text-muted-foreground">{ALL_CLOSED}</p>
          <div className="flex items-center gap-1.5">
            {PANELS.map((id) => (
              <PanelToggle key={id} id={id} open={false} onToggle={toggle} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {sidePanels ? (
            // The Agent panel keeps its width; these two scroll sideways.
            <div className="flex min-w-0 flex-1 overflow-x-auto">
              {panels.specs ? (
                <Panel
                  id="specs"
                  ownTab={ownTabHref("specs", pathname, drivePathOf(pathname))}
                  onClose={toggle}
                >
                  {explorer}
                </Panel>
              ) : null}
              {panels.test ? (
                <Panel
                  id="test"
                  ownTab={ownTabHref("test", pathname, drivePathOf(pathname))}
                  onClose={toggle}
                >
                  <TestPreview />
                </Panel>
              ) : null}
            </div>
          ) : null}
          {panels.agent ? (
            <Panel id="agent" narrow={sidePanels} onClose={toggle}>
              <ChatPane
                document={document}
                dispatch={dispatch}
                selectedSessionId={sessionId}
                onSelectSession={setSessionId}
                driveLoaded={true}
              />
            </Panel>
          ) : null}
        </div>
      )}

      {settingsOpen ? (
        <SettingsDialog
          product={result.product}
          productId={result.productId}
          drive={document}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <PublishPermissionModal
        productId={result.productId}
        studioId={document.header.id}
      />
      {showDebug ? <ProductDebugPanel drive={document} /> : null}
    </div>
  );
}

function ShellLoading() {
  return (
    <div
      aria-busy="true"
      className={`${PAGE} items-center justify-center text-sm text-muted-foreground`}
    >
      Opening your Studio…
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PanelToggle({
  id,
  open,
  onToggle,
}: {
  id: PanelId;
  open: boolean;
  onToggle: (id: PanelId) => void;
}) {
  return (
    <button
      type="button"
      data-panel-toggle={id}
      aria-pressed={open}
      onClick={() => onToggle(id)}
      className={`h-7 rounded-md border px-2.5 text-xs font-medium ${
        open
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:bg-accent"
      }`}
    >
      {PANEL_LABELS[id]}
    </button>
  );
}

function Panel({
  id,
  ownTab,
  narrow = false,
  onClose,
  children,
}: {
  id: PanelId;
  /** The panel's address in a tab of its own. */
  ownTab?: string;
  /** Keeps a fixed width beside other panels. */
  narrow?: boolean;
  onClose: (id: PanelId) => void;
  children: ReactNode;
}) {
  const label = PANEL_LABELS[id];
  return (
    <section
      aria-label={label}
      data-panel={id}
      className={`flex min-h-0 flex-col border-r border-border last:border-r-0 ${
        id === "agent"
          ? narrow
            ? "w-[420px] max-w-full shrink-0 border-l"
            : "min-w-0 flex-1"
          : "min-w-[640px] flex-1"
      }`}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {label}
        </h2>
        {ownTab ? (
          <a
            href={ownTab}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${label} in its own tab`}
            title="Open in its own tab"
            className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ↗
          </a>
        ) : null}
        <button
          type="button"
          aria-label={`Close ${label}`}
          title="Close"
          onClick={() => onClose(id)}
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

/** Test (the Preview Connect on the project) and Preview (the project's host). */
function TestPreview() {
  const [mode, setMode] = useState<"test" | "preview">("test");
  return (
    <div data-test-preview={mode} className="flex h-full flex-col">
      <div
        role="group"
        aria-label="Test or Preview"
        className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-3 py-1.5"
      >
        {(["test", "preview"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`h-6 rounded-full border px-2.5 text-xs font-medium ${
              mode === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground hover:bg-accent"
            }`}
          >
            {value === "test" ? "Test" : "Preview"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {mode === "test" ? <TestFrame /> : <PreviewHosts />}
      </div>
    </div>
  );
}

/** The Preview Connect on its `preview` drive, or why it is not there. */
function TestFrame() {
  const home = usePreviewHome();
  if (home.kind === "ready") {
    return (
      <iframe
        data-test-frame
        title={TEST_FRAME_TITLE}
        src={home.url}
        className="h-full w-full border-0 bg-background"
      />
    );
  }
  if (home.kind === "unavailable" || home.kind === "failed") {
    const detail = home.kind === "unavailable" ? home.reason : home.error;
    return (
      <div
        data-test-state={home.kind}
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
      >
        <p className="font-medium text-foreground">
          {home.kind === "unavailable" ? TEST_UNAVAILABLE : TEST_FAILED}
        </p>
        <p className="max-w-xl whitespace-pre-wrap break-words">{detail}</p>
        {home.kind === "unavailable" && home.hint ? (
          <p className="max-w-xl whitespace-pre-wrap break-words">
            {home.hint}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div data-test-state={home.kind} className="h-full">
      <Notice>{home.kind === "stopped" ? TEST_STOPPED : TEST_STARTING}</Notice>
    </div>
  );
}
