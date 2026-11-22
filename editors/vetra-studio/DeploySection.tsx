import { useRenown } from "@powerhousedao/reactor-browser";
import { Rocket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeployTarget } from "./hooks/useSessionDeployTarget.js";
import { resolveDeployProject } from "./deploy/resolveDeployProject.js";
import { Breadcrumb, type Crumb } from "./Breadcrumb.js";
import { useCloudAuth } from "./deploy/cloudAuth.js";
import { GithubConnectCard } from "./deploy/GithubConnectCard.js";
import { getAuthToken, setAuthTokenProvider } from "./deploy/cloudClient.js";
import { resolveCloudDriveId } from "./deploy/config.js";
import { ProjectDeployDetail } from "./deploy/ProjectDeployDetail.js";
import {
  ProjectDeployList,
  type ProjectDeployment,
} from "./deploy/ProjectDeployList.js";
import {
  deriveEnvDeployments,
  type DeployData,
  type PackageView,
} from "./deploy/projectDeployments.js";
import {
  useCloudEnvironments,
  type EnvironmentsState,
} from "./deploy/useCloudEnvironments.js";
import {
  useInstalledPackages,
  type InstalledPackagesState,
} from "./deploy/useInstalledPackages.js";
import {
  useProjectPackageInfo,
  type ProjectPackageState,
} from "./deploy/useProjectPackageInfo.js";
import {
  useReleaseStatus,
  type ReleaseStatus,
} from "./deploy/useReleaseStatus.js";
import {
  PROJECT_FALLBACK_NAME,
  PROJECT_ID,
  type Project,
} from "./specify/projects.js";
import { useSpecDocuments } from "./specify/useSpecDocuments.js";

const UNKNOWN_RELEASE: ReleaseStatus = { known: false };

type View = { kind: "list" } | { kind: "deploy" };

/** Adapt the package lookup to the deploy detail's package view. */
function toPackageView(pkg: ProjectPackageState): PackageView {
  if (pkg.status === "loading") return { status: "loading" };
  if (pkg.status === "error") return { status: "error", message: pkg.message };
  return pkg.info
    ? { status: "ready", name: pkg.info.name, version: pkg.info.version }
    : { status: "error", message: "No package.json found for this project." };
}

/** Resolve the deploy detail's data for the project, gated on sign-in and every
 * source loading, so the variants render fully-formed. */
function buildDeployData(args: {
  authorized: boolean;
  authLoading: boolean;
  envs: EnvironmentsState;
  installed: InstalledPackagesState;
  release: ReleaseStatus;
  pkg: PackageView;
}): DeployData {
  const { authorized, authLoading, envs, installed, release, pkg } = args;
  if (!authorized) return { kind: "unauthenticated" };
  if (authLoading) return { kind: "loading" };
  if (envs.status === "loading") return { kind: "loading" };
  if (envs.status === "error") return { kind: "error", message: envs.error };
  if (installed.status === "idle" || installed.status === "loading")
    return { kind: "loading" };
  if (installed.status === "error")
    return { kind: "error", message: installed.message };
  if (pkg.status === "loading") return { kind: "loading" };
  if (pkg.status === "error") return { kind: "error", message: pkg.message };
  return {
    kind: "ready",
    environments: deriveEnvDeployments({
      environments: envs.items,
      byEnv: installed.byEnv,
      packageName: pkg.name,
      release,
    }),
  };
}

/** Home > Deploy. Requires a Renown sign-in, then shows the project the Studio
 * runs in with its deploy status (which of the user's environments has its
 * package installed) and lets the user deploy it. The list waits for envs +
 * package data so the card renders fully resolved. */
export function DeploySection({
  productName,
  onExitToHome,
  focus,
  deployActivity,
}: {
  productName: string;
  onExitToHome: () => void;
  /** Auto-nav target: the deploy the agent is running. Applied once per
   * deploy (keyed by callId); null when nothing is being followed. */
  focus?: DeployTarget | null;
  /** Id of the newest completed deploy command in the chat. Advances when an
   * agent deploy finishes; we re-fetch the once-loaded install/release data so
   * the view doesn't keep showing stale "Not deployed here". */
  deployActivity?: string | null;
}) {
  const renown = useRenown();
  const auth = useCloudAuth();
  const driveId = resolveCloudDriveId(auth.address);
  const { state: envs, refresh } = useCloudEnvironments(
    auth.authorized,
    auth.address,
  );
  const [view, setView] = useState<View>({ kind: "list" });
  // Bumped after a successful deploy to re-resolve package/release/install data.
  const [reloadNonce, setReloadNonce] = useState(0);
  // The version we just deployed; trusted over the (briefly stale) registry
  // until the registry catches up to it.
  const [deployedVersion, setDeployedVersion] = useState<string | null>(null);

  const specs = useSpecDocuments();
  const pkgState = useProjectPackageInfo(reloadNonce);
  const releaseState = useReleaseStatus(reloadNonce);
  const envSummaries =
    envs.status === "ready"
      ? envs.items.map((e) => ({ id: e.id, name: e.name }))
      : [];
  const installed = useInstalledPackages(
    envSummaries,
    driveId,
    auth.signer,
    reloadNonce,
  );
  const packageInfo = pkgState.status === "ready" ? pkgState.info : null;
  const project: Project = {
    id: PROJECT_ID,
    name: packageInfo?.name ?? PROJECT_FALLBACK_NAME,
    documents: specs,
  };

  // Attach the no-aud Renown token to every cloud client request.
  useEffect(() => {
    setAuthTokenProvider(() => getAuthToken(renown));
    return () => setAuthTokenProvider(null);
  }, [renown]);

  // Auto-nav focus: open the project's deploy detail when the agent deploys
  // it. Applied once per focus (keyed by callId) so navigating within Deploy
  // isn't overridden until the next deploy; retried while the package data is
  // still loading, then given up if the target isn't the project (e.g. an
  // external package) so we neither loop nor strand.
  const appliedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focus.callId === appliedFocusRef.current) return;
    const match = resolveDeployProject(
      focus,
      pkgState.status === "ready" ? pkgState.info : undefined,
    );
    if (match === null && pkgState.status === "loading") return;
    appliedFocusRef.current = focus.callId;
    if (match) setView({ kind: "deploy" });
  }, [focus, pkgState]);

  // Re-fetch the once-loaded install/release/package data when an agent deploy
  // finishes in the chat (its env writes happen outside the UI, so the card
  // would otherwise keep showing pre-deploy state). Same refresh the UI's own
  // Deploy button triggers via onDeployed. Seeded per mount so the initial
  // fetch isn't immediately redone; a remount re-fetches on its own.
  const seenActivityRef = useRef<string | null>(null);
  const activitySeededRef = useRef(false);
  useEffect(() => {
    if (!activitySeededRef.current) {
      activitySeededRef.current = true;
      seenActivityRef.current = deployActivity ?? null;
      return;
    }
    if (!deployActivity || deployActivity === seenActivityRef.current) return;
    seenActivityRef.current = deployActivity;
    setReloadNonce((n) => n + 1);
    refresh();
  }, [deployActivity, refresh]);

  const atRoot = view.kind === "list";
  const goToList = () => setView({ kind: "list" });
  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    { label: "Deploy", onClick: atRoot ? undefined : goToList },
    ...(view.kind === "deploy" ? [{ label: project.name }] : []),
  ];

  const listError =
    envs.status === "error"
      ? envs.error
      : installed.status === "error"
        ? installed.message
        : pkgState.status === "error"
          ? pkgState.message
          : null;
  const listLoading =
    envs.status === "loading" ||
    pkgState.status === "loading" ||
    releaseState.status === "loading" ||
    installed.status === "loading" ||
    installed.status === "idle";

  // After a deploy the registry packument is stale for a while, so it still
  // reports "needs release". Trust the version we just published until the
  // registry's latest catches up to it, then defer to the live status again.
  const liveRelease =
    releaseState.status === "ready" ? releaseState.release : UNKNOWN_RELEASE;
  const release: ReleaseStatus =
    deployedVersion &&
    !(liveRelease.known && liveRelease.publishedVersion === deployedVersion)
      ? {
          known: true,
          upToDate: true,
          needsRelease: false,
          localVersion: deployedVersion,
          publishedVersion: deployedVersion,
        }
      : liveRelease;

  const pkg = toPackageView(pkgState);
  const deployments: ProjectDeployment[] = [
    {
      project,
      deployedEnvironments:
        packageInfo && installed.status === "ready"
          ? (installed.byPackage.get(packageInfo.name) ?? [])
          : [],
      release,
    },
  ];
  const deploy: DeployData = buildDeployData({
    authorized: auth.authorized,
    authLoading: auth.loading,
    envs,
    installed,
    release,
    pkg,
  });

  return (
    <div data-tour="deploy-projects" className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {!auth.authorized ? (
        <AuthGate loading={auth.loading} onLogin={auth.login} />
      ) : view.kind === "deploy" ? (
        <ProjectDeployDetail
          project={project}
          pkg={pkg}
          release={release}
          deploy={deploy}
          driveId={driveId}
          signer={auth.signer}
          onSignIn={auth.login}
          onRefresh={refresh}
          onDeployed={(version) => {
            setDeployedVersion(version);
            setReloadNonce((n) => n + 1);
            refresh();
          }}
        />
      ) : listError ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 py-6">
          <p className="text-sm text-destructive">{listError}</p>
          <button
            type="button"
            onClick={refresh}
            className="text-sm text-vetra-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : listLoading ? (
        <ProjectsLoading />
      ) : (
        <div className="flex flex-col gap-5">
          <GithubConnectCard authorized={auth.authorized} />
          <ProjectDeployList
            deployments={deployments}
            onDeploy={() => setView({ kind: "deploy" })}
          />
        </div>
      )}
    </div>
  );
}

function ProjectsLoading() {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-foreground">Project</h3>
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]">
        <div className="flex animate-pulse flex-col gap-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-9 w-full rounded-lg bg-muted" />
        </div>
      </div>
    </section>
  );
}

function AuthGate({
  loading,
  onLogin,
}: {
  loading: boolean;
  onLogin: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-24 text-center">
      <Rocket size={28} className="text-vetra-primary" />
      <h2 className="text-lg font-semibold text-foreground">
        Deploy to vetra.io
      </h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Checking sign-in…</p>
      ) : (
        <>
          <p className="max-w-md text-sm text-muted-foreground">
            Sign in with Renown to see your project and deploy it to the cloud.
          </p>
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
          >
            Connect with Renown
          </button>
        </>
      )}
    </div>
  );
}
