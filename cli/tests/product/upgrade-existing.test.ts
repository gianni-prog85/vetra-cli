/**
 * Version 1 of a product with work from before versions (Task 3.7, spec
 * §6.6): a real in-memory reactor with a product whose story starts with a
 * BEFORE_VERSIONS change, a real workspace, and a fake cloud.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactorBuilder, ReactorClientBuilder, type InProcessReactorClientModule } from "@powerhousedao/reactor";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import { withSignaturePolicy } from "document-model";
import { StudioProductV1 } from "document-models";
import type { StudioProductDocument, StudioProductState } from "document-models/studio-product";
import { LaunchError } from "../../src/launch/errors.js";
import { autoLaunchCandidate, ensureLiveTarget, type OrchestratorContext } from "../../src/launch/orchestrator.js";
import { runProgress } from "../../src/commands/product/progress.js";
import { NOT_AUTHENTICATED } from "../../src/cloud/environments-read.js";
import type { ProductTarget } from "../../src/launch/cloud-launch.js";
import {
  ensureProductTarget,
  environmentUrl,
  readUpgradeRecord,
  type LiveCandidate,
  type UpgradeContext,
  type WorkspacePackages,
} from "../../src/product/upgrade-existing.js";

const a = StudioProductV1.actions;
const NOW = "2026-10-21T12:00:00.000Z";
const PROD_SWITCHBOARD = "https://switchboard.vetra.io";
const OLD_ENV: LiveCandidate = { environmentId: "env-old", url: "https://bold-crow-connect.vetra.io" };

interface Harness {
  module: InProcessReactorClientModule;
  productId: string;
  workdir: string;
  ctx: UpgradeContext;
  liveCalls: WorkspacePackages[];
  live: LiveCandidate[] | Error;
  state(): Promise<StudioProductState>;
  project(dir: string): void;
}

let h: Harness;

/** A product whose story starts with the work from before versions; with
 * `live`, an environment shown as live before versions. */
async function harness(opts: { live?: LiveCandidate } = {}): Promise<Harness> {
  const builder = new ReactorBuilder().withDocumentModelSources([
    driveDocumentModelModule as never,
    StudioProductV1 as never,
  ]);
  const module = await new ReactorClientBuilder()
    .withReactorBuilder(builder)
    .withCreateSignaturePolicy("legacy")
    .buildModule();
  const driveId = (await module.client.createEmpty("powerhouse/document-drive")).header.id;
  const productId = (
    await module.client.createDocumentInDrive(
      driveId,
      withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy"),
    )
  ).header.id;
  await module.client.execute(productId, "main", [
    a.initProduct({ name: "Todo app", idea: "build a todo app", createdAt: NOW }),
    a.adoptExisting({
      changeId: "before-versions",
      request: "Before versions",
      chatSessionIds: [],
      doneSteps: ["PLAN", "DATA"],
      at: NOW,
    }),
    ...(opts.live
      ? [a.setLiveBeforeVersions({ environmentId: opts.live.environmentId, url: opts.live.url, at: NOW })]
      : []),
  ]);
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-existing-"));
  const liveCalls: WorkspacePackages[] = [];
  const self: Harness = {
    module,
    productId,
    workdir,
    liveCalls,
    live: [],
    ctx: {
      folders: {},
      reactor: async () => ({ client: module.client, personalDriveId: driveId, driveId }),
      workdir,
      config: { cloudSwitchboardUrl: PROD_SWITCHBOARD, environmentId: "studio-env" },
      env: {},
      now: () => new Date(NOW),
      log: {},
      upgradeDeps: {
        findLiveEnvironments: async (_ctx, workspace) => {
          liveCalls.push(workspace);
          if (self.live instanceof Error) throw self.live;
          return self.live;
        },
      },
    },
    async state() {
      const d = await module.client.get<StudioProductDocument>(productId);
      return d.state.global;
    },
    project(dir) {
      const root = path.join(workdir, dir);
      fs.mkdirSync(path.join(root, "document-models", "todo"), { recursive: true });
      fs.writeFileSync(path.join(root, "powerhouse.config.json"), JSON.stringify({ studio: { port: 3000 } }));
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: `@vetra-apps/${dir}` }));
    },
  };
  started.push(self);
  return self;
}

const started: Harness[] = [];

afterEach(async () => {
  for (const s of started.splice(0)) {
    await s.module.reactor.kill().completed;
    fs.rmSync(s.workdir, { recursive: true, force: true });
  }
});

const TARGET: ProductTarget = {
  appId: "app-1",
  productionEnvironmentId: "env-old",
  slug: "bold-crow",
  liveUrl: "https://bold-crow.vetra.io",
};

describe("ensureProductTarget", () => {
  it("Version 1 adopts the env live before versions; a refusal gives a new address", async () => {
    h = await harness({ live: OLD_ENV });
    const calls: { name: string; adopt?: string }[] = [];
    const ensure = async (name: string, opts?: { adoptEnvironmentId?: string }) => {
      calls.push({ name, adopt: opts?.adoptEnvironmentId });
      return TARGET;
    };
    expect(await ensureProductTarget(h.ctx, await h.state(), "Todo app", ensure)).toEqual(TARGET);
    expect(calls).toEqual([{ name: "Todo app", adopt: "env-old" }]);
    expect(readUpgradeRecord(h.workdir).liveTarget).toMatchObject({ path: "adopted", environmentId: "env-old" });

    // Refused by the cloud: a new address (E10), the old env is left as it is.
    calls.length = 0;
    const refusing = async (name: string, opts?: { adoptEnvironmentId?: string }) => {
      calls.push({ name, adopt: opts?.adoptEnvironmentId });
      if (opts?.adoptEnvironmentId) throw new LaunchError("ADOPT_NOT_ALLOWED", "refused", "linked to an App");
      return { ...TARGET, productionEnvironmentId: "env-new", slug: "todo-app" };
    };
    const fallback = await ensureProductTarget(h.ctx, await h.state(), "Todo app", refusing);
    expect(fallback.productionEnvironmentId).toBe("env-new");
    expect(calls).toEqual([
      { name: "Todo app", adopt: "env-old" },
      { name: "Todo app", adopt: undefined },
    ]);
    expect(readUpgradeRecord(h.workdir).liveTarget).toMatchObject({ path: "new", environmentId: "env-new" });

    // Any other refusal is not a fallback.
    const failing = async () => {
      throw new LaunchError("STUDIO_BINDING", "refused");
    };
    await expect(ensureProductTarget(h.ctx, await h.state(), "Todo app", failing)).rejects.toThrow("refused");
  });

  it("the launch's live target adopts the environment through ensureStudioProduct", async () => {
    h = await harness({ live: OLD_ENV });
    const seen: (string | undefined)[] = [];
    const octx = {
      ...h.ctx,
      deps: {
        ensureProduct: async (_c: unknown, _name: string, opts?: { adoptEnvironmentId?: string }) => {
          seen.push(opts?.adoptEnvironmentId);
          return TARGET;
        },
      },
    } as unknown as OrchestratorContext;
    const s = await ensureLiveTarget(octx);
    expect(seen).toEqual(["env-old"]);
    expect(s).toMatchObject({ appId: "app-1", productionEnvironmentId: "env-old", slug: "bold-crow" });
    // Shown as live before versions until Version 1 is live.
    expect(s.liveBeforeVersions?.environmentId).toBe("env-old");
  });

  it("several environments with the workspace: none is adopted, Version 1 gets a new address", async () => {
    h = await harness();
    h.project("todo-app");
    h.live = [OLD_ENV, { environmentId: "env-other", url: "https://calm-fox-connect.vetra.io" }];
    const calls: (string | undefined)[] = [];
    await ensureProductTarget(h.ctx, await h.state(), "Todo app", async (_n, opts) => {
      calls.push(opts?.adoptEnvironmentId);
      return { appId: "a", productionEnvironmentId: "env-new", slug: "todo-app", liveUrl: "https://todo-app.vetra.io" };
    });
    expect(calls).toEqual([undefined]);
    // The workspace's packages are looked for, with the stack's registry (R25).
    expect(h.liveCalls).toEqual([{ names: ["@vetra-apps/todo-app"], registries: ["https://registry.vetra.io"] }]);
    expect(readUpgradeRecord(h.workdir).liveTarget).toMatchObject({ path: "new" });
    expect((await h.state()).liveBeforeVersions).toBeNull();
  });

  it("one env that also runs other packages is ambiguous: a new address (E10)", async () => {
    h = await harness();
    h.project("todo-app");
    h.live = [{ ...OLD_ENV, mismatch: "it also runs @acme/other" }];
    const ensure = vi.fn(async (_n: string, _opts?: { adoptEnvironmentId?: string }) => TARGET);
    await ensureProductTarget(h.ctx, await h.state(), "Todo app", ensure);
    expect(ensure).toHaveBeenCalledWith("Todo app");
    expect((await h.state()).liveBeforeVersions).toBeNull();
  });

  it("a live check that can't run stops the launch instead of guessing", async () => {
    h = await harness();
    h.project("todo-app");
    h.live = new Error("fetch failed");
    const ensure = vi.fn(async () => TARGET);
    await expect(ensureProductTarget(h.ctx, await h.state(), "Todo app", ensure)).rejects.toMatchObject({
      code: "CLOUD_UNAVAILABLE",
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("not signed in during the live check is the owner's missing OK, not an outage", async () => {
    h = await harness();
    h.project("todo-app");
    h.live = new Error(NOT_AUTHENTICATED);
    const ensure = vi.fn(async () => TARGET);
    await expect(ensureProductTarget(h.ctx, await h.state(), "Todo app", ensure)).rejects.toMatchObject({
      code: "DELEGATION_MISSING",
    });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("before an explicit launch", () => {
  beforeEach(async () => {
    h = await harness({ live: OLD_ENV });
  });

  it("the adopted env is never touched while a change is built (no early live target)", async () => {
    await h.module.client.execute(h.productId, "main", [
      a.startChange({ id: "c1", kind: "CHANGE", request: "add due dates", startedAt: NOW }),
    ]);
    const ensure = vi.fn(async () => TARGET);
    const ctx = { ...h.ctx, deps: { ensureProduct: ensure } } as unknown as Parameters<typeof runProgress>[0];
    await runProgress(ctx, { action: "title", text: "Due dates" });
    await runProgress(ctx, { action: "plan", steps: [{ kind: "PLAN" }, { kind: "DATA" }] });
    await runProgress(ctx, { action: "start", step: "PLAN" });
    expect(await runProgress(ctx, { action: "done", step: "PLAN" })).toContain("Plan done.");
    await new Promise((r) => setTimeout(r, 50));
    expect(ensure).not.toHaveBeenCalled();
    expect((await h.state()).appId).toBeNull();
  });

  it("a READY change is not launched by itself: Version 1 waits for Make it live (X33)", async () => {
    const ready = { ...(await h.state()) };
    ready.changes = [
      ...ready.changes,
      { ...ready.changes[0], id: "c1", kind: "CHANGE", status: "READY" },
    ];
    expect(autoLaunchCandidate(ready)).toBeNull();
    // Also without an env live before versions: one found at launch time
    // would be adopted.
    expect(autoLaunchCandidate({ ...ready, liveBeforeVersions: null })).toBeNull();
    // A product without work from before versions keeps its automatic first launch.
    const fresh = { ...ready, changes: ready.changes.filter((c) => c.kind !== "BEFORE_VERSIONS"), liveBeforeVersions: null };
    expect(autoLaunchCandidate(fresh)?.id).toBe("c1");
  });
});

describe("environmentUrl", () => {
  const base = {
    genericSubdomain: "bold-crow",
    genericBaseDomain: null,
    apexService: null,
    services: [{ type: "CONNECT", enabled: true, prefix: "connect" }],
  };
  it("is Connect's own host, or the apex when Connect is there", () => {
    expect(environmentUrl(base as never)).toBe("https://bold-crow-connect.vetra.io");
    expect(environmentUrl({ ...base, apexService: "CONNECT" } as never)).toBe("https://bold-crow.vetra.io");
    expect(environmentUrl({ ...base, services: [] } as never)).toBe("https://bold-crow.vetra.io");
    expect(environmentUrl({ ...base, genericSubdomain: null } as never)).toBeNull();
  });
});
