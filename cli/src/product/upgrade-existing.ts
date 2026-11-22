/**
 * Version 1 of a product that has work from before versions (spec §6.6, G11).
 *
 * A product whose story starts with a CLOSED BEFORE_VERSIONS change
 * (`ADOPT_EXISTING`, Ruling F5) and has no version yet launches its first
 * version through `ensureProductTarget`. When exactly one environment of the
 * owner (not a Studio) runs the workspace's packages, or one was recorded as
 * live before versions (`SET_LIVE_BEFORE_VERSIONS`), it is adopted as the
 * product's production environment (`adoptEnvironmentId`, Ruling F28) so its
 * address keeps updating; when the choice is ambiguous or the cloud refuses
 * it, the product gets a new address and the old environments stay as they
 * are, listed in Settings › Advanced (E10). Environments are only read, never
 * changed. Which path a launch took is logged and kept in
 * `.ph/vetra/upgrade-existing.json`.
 */
import fs from "node:fs";
import path from "node:path";
import type { Action } from "document-model";
import {
  CLOUD_BASE_DOMAIN,
  isStudioEnvironment,
  type VetraCloudEnvironmentGlobalState,
} from "../../../cloud-client/index.js";
import type { StudioProductState } from "document-models/studio-product";
import type { Config } from "../framework.js";
import { workspaceProjectDirs } from "../launch/workspace-layout.js";
import { studioPath } from "../helpers/studio-paths.js";
import { resolveLaunchRegistryUrl } from "../cloud/registry-url.js";
import {
  NOT_AUTHENTICATED,
  listMyEnvironments,
  type ReadContext,
} from "../cloud/environments-read.js";
import { loadEnvironmentState } from "../cloud/environments-write.js";
import { LaunchError } from "../launch/errors.js";
import { REASONS, type ProductTarget } from "../launch/cloud-launch.js";
import {
  dispatchProduct,
  productActions as a,
  type ProductContext,
} from "./product-doc.js";

const TAG = "[upgrade]";

/** Environment statuses that no longer serve anything. */
const GONE_STATUSES = new Set(["ARCHIVED", "DESTROYED", "TERMINATING", "DRAFT"]);

/* ------------------------------------------------------------------------ */
/* Context                                                                   */
/* ------------------------------------------------------------------------ */

/** An environment that runs the workspace's packages. */
export interface LiveCandidate {
  environmentId: string;
  url: string;
  /** Why it can't be adopted as it is (other packages, another registry). */
  mismatch?: string;
}

/** The workspace's packages and the registries they publish to (when known). */
export interface WorkspacePackages {
  names: string[];
  registries: string[];
}

export interface UpgradeDeps {
  listProjects: (workdir: string) => Promise<string[]>;
  /** The owner's environments (not Studios) that run any of the workspace's packages. */
  findLiveEnvironments: (ctx: UpgradeContext, workspace: WorkspacePackages) => Promise<LiveCandidate[]>;
}

export interface UpgradeContext extends ProductContext {
  workdir: string;
  config: Pick<
    Config,
    "cloudSwitchboardUrl" | "cloudRenownUrl" | "environmentId" | "registryUrl"
  >;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  /** Seams for tests (its own key: the launch context has `deps` of its own). */
  upgradeDeps?: Partial<UpgradeDeps>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

const defaultDeps: UpgradeDeps = {
  listProjects: workspaceProjectDirs,
  findLiveEnvironments: findOwnerEnvironmentsRunning,
};

function depsOf(ctx: UpgradeContext): UpgradeDeps {
  return { ...defaultDeps, ...ctx.upgradeDeps };
}

function nowIso(ctx: UpgradeContext): string {
  return (ctx.now ?? (() => new Date()))().toISOString();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------------ */
/* Record                                                                    */
/* ------------------------------------------------------------------------ */

export interface UpgradeRecord {
  /** The first launch's choice (F28 adopt, or E10 new address). */
  liveTarget?: {
    path: "adopted" | "new";
    environmentId: string | null;
    reason: string;
    at: string;
  };
}

export function readUpgradeRecord(workdir: string): UpgradeRecord {
  try {
    return JSON.parse(fs.readFileSync(studioPath(workdir, "upgradeRecord"), "utf-8")) as UpgradeRecord;
  } catch {
    return {};
  }
}

function writeUpgradeRecord(ctx: UpgradeContext, patch: UpgradeRecord): void {
  try {
    const file = studioPath(ctx.workdir, "upgradeRecord");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...readUpgradeRecord(ctx.workdir), ...patch }, null, 2));
  } catch (err) {
    ctx.log?.warn?.(`${TAG} couldn't keep the upgrade record: ${message(err)}`);
  }
}

/** The workspace's package names (each reactor project's package.json). */
export function workspacePackages(workdir: string, projects: string[]): string[] {
  const names: string[] = [];
  for (const p of projects) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workdir, p, "package.json"), "utf-8")) as {
        name?: unknown;
      };
      if (typeof pkg.name === "string" && pkg.name.trim()) names.push(pkg.name.trim());
    } catch {
      // A project without a readable package.json has nothing published.
    }
  }
  return names;
}

/* ------------------------------------------------------------------------ */
/* The environment that was live before versions                             */
/* ------------------------------------------------------------------------ */

/** The address customers open: Connect at the apex, else its own host. */
export function environmentUrl(state: VetraCloudEnvironmentGlobalState): string | null {
  const sub = state.genericSubdomain;
  if (!sub) return null;
  const base = state.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  if (state.apexService === "CONNECT") return `https://${sub}.${base}`;
  const connect = state.services.find((s) => s.type === "CONNECT" && s.enabled);
  return connect ? `https://${sub}-${connect.prefix}.${base}` : `https://${sub}.${base}`;
}

const GONE_HTTP_STATUSES = new Set([404, 410]);
const GONE_CODES = new Set(["NOT_FOUND", "DOCUMENT_NOT_FOUND", "GONE"]);
/**
 * Gone in words, said of a document or an environment ("Document not found:
 * x", "Environment x does not exist"); any other "not found" (a user, a
 * credential) isn't. `\b` keeps a DNS failure (`ENOTFOUND`) out.
 */
const GONE_WORDS =
  /\b(?:document|environment)\b[^.;\n]{0,80}?\b(?:not[ _-]?found|does not exist|doesn't exist|has been deleted)\b|\bno such (?:document|environment)\b/i;
/** 404/410 only where a message states an HTTP status, never in ports or ids. */
const GONE_HTTP_TEXT = /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?:?)\s*(?:404|410)\b|^(?:404|410)\s+(?:not found|gone)\b/i;

function goneStatus(value: unknown): boolean {
  return typeof value === "number" && GONE_HTTP_STATUSES.has(value);
}

function goneCode(value: unknown): boolean {
  return typeof value === "string" && GONE_CODES.has(value.toUpperCase());
}

/**
 * An error that says the environment document is gone (not a passing
 * failure): its words, an HTTP 404/410 status (stated in the message, or on
 * the error, its response or its cause) or a GraphQL not-found code.
 */
export function isGoneError(err: unknown): boolean {
  return goneAt(err, 0);
}

function goneAt(err: unknown, depth: number): boolean {
  if (depth > 3) return false;
  const text = message(err);
  if (GONE_WORDS.test(text) || GONE_HTTP_TEXT.test(text)) return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    extensions?: { code?: unknown };
    graphQLErrors?: unknown;
    errors?: unknown;
    cause?: unknown;
  };
  if (goneStatus(e.status) || goneStatus(e.statusCode) || goneStatus(e.response?.status)) return true;
  if (goneCode(e.extensions?.code)) return true;
  for (const list of [e.graphQLErrors, e.errors]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as { extensions?: { code?: unknown } }[]) {
      if (goneCode(item?.extensions?.code)) return true;
    }
  }
  return e.cause !== undefined && goneAt(e.cause, depth + 1);
}

/** Packages the platform installs itself; they don't make an env someone else's. */
function isSystemPackage(name: string): boolean {
  return name.startsWith("@powerhousedao/");
}

function sameRegistry(x: string, y: string): boolean {
  return x.trim().replace(/\/+$/, "") === y.trim().replace(/\/+$/, "");
}

/** Why `state` can't simply become the product's environment, or null. */
function mismatchOf(state: VetraCloudEnvironmentGlobalState, workspace: WorkspacePackages): string | null {
  const wanted = new Set(workspace.names);
  const others = state.packages.filter((p) => !isSystemPackage(p.name) && !wanted.has(p.name));
  if (others.length > 0) return `it also runs ${others.map((p) => p.name).join(", ")}`;
  if (workspace.registries.length > 0) {
    const foreign = state.packages.filter(
      (p) => wanted.has(p.name) && p.registry && !workspace.registries.some((r) => sameRegistry(r, p.registry)),
    );
    if (foreign.length > 0) return `${foreign.map((p) => p.name).join(", ")} comes from another registry`;
  }
  return null;
}

/**
 * The owner's environments that run any of the workspace's packages: never
 * the Studio itself or another Studio, never one that is gone. One that also
 * runs other packages, or the workspace's from another registry, is listed
 * with its `mismatch` (it makes the choice ambiguous). An environment whose
 * document is clearly gone is skipped. Throws when the list or any other
 * environment can't be read (not signed in, offline, 5xx): the caller treats
 * the answer as pending and tries again later.
 */
export async function findOwnerEnvironmentsRunning(
  ctx: UpgradeContext,
  workspace: WorkspacePackages,
): Promise<LiveCandidate[]> {
  if (workspace.names.length === 0) return [];
  const read = ctx as unknown as ReadContext;
  const wanted = new Set(workspace.names);
  const studioId = ctx.config.environmentId?.trim() ?? null;
  const out: LiveCandidate[] = [];
  for (const env of await listMyEnvironments(read, "MINE")) {
    if (env.id === studioId) continue;
    if (env.status && GONE_STATUSES.has(env.status)) continue;
    let state: VetraCloudEnvironmentGlobalState;
    try {
      state = await loadEnvironmentState(read, env.id);
    } catch (err) {
      // Only an env that is clearly gone is left out; anything else (not
      // signed in, network, 5xx) leaves the answer pending for a retry, so a
      // half-read list never changes which env is adopted.
      if (!isGoneError(err)) throw err;
      ctx.log?.warn?.(`${TAG} skipped environment ${env.id}: it no longer exists (${message(err)})`);
      continue;
    }
    if (GONE_STATUSES.has(state.status)) continue;
    const installed = state.packages.map((p) => p.name);
    if (isStudioEnvironment(installed)) continue;
    if (!installed.some((n) => wanted.has(n))) continue;
    const url = environmentUrl(state);
    if (!url) continue;
    const mismatch = mismatchOf(state, workspace);
    out.push(mismatch ? { environmentId: env.id, url, mismatch } : { environmentId: env.id, url });
  }
  return out;
}

type LiveFinding =
  | { check: "one"; env: LiveCandidate }
  | { check: "none" }
  | { check: "many"; ids: string[] };

/** Where each project publishes at launch, when that can be told now. */
function workspaceRegistries(ctx: UpgradeContext, projects: string[]): string[] {
  const out = new Set<string>();
  for (const p of projects) {
    try {
      out.add(
        resolveLaunchRegistryUrl({
          registry: ctx.config.registryUrl,
          projectPath: path.join(ctx.workdir, p),
          env: ctx.env,
          environmentId: ctx.config.environmentId,
          cloudSwitchboardUrl: ctx.config.cloudSwitchboardUrl,
        }),
      );
    } catch {
      // Not determinable: the registry isn't compared.
    }
  }
  return [...out];
}

async function findLive(ctx: UpgradeContext, projects: string[]): Promise<LiveFinding> {
  const workspace = {
    names: workspacePackages(ctx.workdir, projects),
    registries: workspaceRegistries(ctx, projects),
  };
  const found = await depsOf(ctx).findLiveEnvironments(ctx, workspace);
  for (const e of found) {
    if (e.mismatch) ctx.log?.info?.(`${TAG} environment ${e.environmentId} isn't adopted as it is: ${e.mismatch}`);
  }
  if (found.length === 0) return { check: "none" };
  // Exactly one, running only this workspace: anything else is ambiguous (E10).
  if (found.length === 1 && !found[0].mismatch) return { check: "one", env: found[0] };
  return { check: "many", ids: found.map((e) => e.environmentId) };
}

function liveAction(env: LiveCandidate, at: string): Action {
  return a.setLiveBeforeVersions({ environmentId: env.environmentId, url: env.url, at });
}

function logLive(ctx: UpgradeContext, live: LiveFinding): void {
  if (live.check === "one") {
    ctx.log?.info?.(
      `${TAG} ${live.env.url} (environment ${live.env.environmentId}) runs this workspace: shown as live before versions; Version 1 goes there`,
    );
  } else if (live.check === "many") {
    ctx.log?.info?.(
      `${TAG} no single environment runs only this workspace (${live.ids.join(", ")}); Version 1 gets a new address and they stay as they are`,
    );
  }
}

/**
 * True for a product with work from before versions and no version yet. Same
 * rule as the Studio's `adoptedWithoutVersions`
 * (editors/vetra-studio/shell/firstVersion.ts, not importable here without the
 * editor bundle): change both together. Both run the cases in
 * editors/vetra-studio/shell/adoptedWithoutVersions.cases.json.
 */
export function adoptedWithoutVersions(state: StudioProductState): boolean {
  return (
    state.liveVersion == null &&
    state.versions.length === 0 &&
    state.changes.some((c) => c.kind === "BEFORE_VERSIONS")
  );
}

/* ------------------------------------------------------------------------ */
/* Version 1 of an adopted product (F28, E10)                                */
/* ------------------------------------------------------------------------ */

/**
 * The environment Version 1 should adopt, or null for a new address: the one
 * recorded as live before versions, else the one environment that runs the
 * workspace now. Throws a `LaunchError` when that can't be checked, so the
 * launch tries again later instead of making a second address.
 */
export async function adoptionFor(
  ctx: UpgradeContext,
  state: StudioProductState,
): Promise<string | null> {
  if (!adoptedWithoutVersions(state) || state.appId) return null;
  if (state.liveBeforeVersions) return state.liveBeforeVersions.environmentId;
  let live: LiveFinding;
  try {
    live = await findLive(ctx, await depsOf(ctx).listProjects(ctx.workdir));
  } catch (err) {
    const detail = `checking which environment runs this workspace: ${message(err)}`;
    // Not signed in: the owner's OK is missing (F7), not a cloud outage.
    if (message(err) === NOT_AUTHENTICATED) {
      throw new LaunchError("DELEGATION_MISSING", "your Studio needs your OK to publish", detail);
    }
    throw new LaunchError("CLOUD_UNAVAILABLE", REASONS.ensureStudioProduct, detail);
  }
  logLive(ctx, live);
  if (live.check !== "one") return null;
  try {
    await dispatchProduct(ctx, [liveAction(live.env, nowIso(ctx))]);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} couldn't show ${live.env.url} as live before versions: ${message(err)}`);
  }
  return live.env.environmentId;
}

export type EnsureProduct = (
  name: string,
  opts?: { adoptEnvironmentId?: string },
) => Promise<ProductTarget>;

/**
 * The product's App + production environment for the live target. For an
 * adopted product without versions, the environment that was live before
 * versions becomes its production environment (F28); the cloud refusing it
 * (`ADOPT_NOT_ALLOWED`) falls back to a new address (E10). Records the path.
 */
export async function ensureProductTarget(
  ctx: UpgradeContext,
  state: StudioProductState,
  name: string,
  ensure: EnsureProduct,
): Promise<ProductTarget> {
  const adopt = await adoptionFor(ctx, state);
  if (!adopt) {
    const target = await ensure(name);
    if (adoptedWithoutVersions(state) && !state.appId) {
      recordPath(ctx, "new", target.productionEnvironmentId, "no single environment ran this workspace");
    }
    return target;
  }
  try {
    const target = await ensure(name, { adoptEnvironmentId: adopt });
    recordPath(ctx, "adopted", target.productionEnvironmentId, "the environment live before versions");
    return target;
  } catch (err) {
    if (!(err instanceof LaunchError) || err.code !== "ADOPT_NOT_ALLOWED") throw err;
    ctx.log?.warn?.(
      `${TAG} environment ${adopt} can't become the product's live address (${err.message}); Version 1 gets a new one and ${adopt} stays as it is`,
    );
    const target = await ensure(name);
    recordPath(ctx, "new", target.productionEnvironmentId, `environment ${adopt} was refused`);
    return target;
  }
}

function recordPath(
  ctx: UpgradeContext,
  pathTaken: "adopted" | "new",
  environmentId: string | null,
  reason: string,
): void {
  ctx.log?.info?.(
    `${TAG} Version 1 goes to ${pathTaken === "adopted" ? "the adopted" : "a new"} environment ${environmentId ?? "?"} (${reason})`,
  );
  writeUpgradeRecord(ctx, {
    liveTarget: { path: pathTaken, environmentId, reason, at: nowIso(ctx) },
  });
}
