/**
 * studio.config.json: where the Cli writes it (the path hosts/connect serves,
 * `${userData}/.ph/vetra/studio.config.json`), what it says, and that the
 * preview-server trigger writes it for its OS port and removes it at its end.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServiceInstanceStatus } from "@powerhousedao/clint";
import {
  removeStudioConfig,
  studioConfigFor,
  studioConfigPath,
  writeStudioConfig,
} from "../../src/preview-server/studio-config.js";
import { previewServerTrigger } from "../../src/triggers/preview-server.js";
import { defaultConfig } from "../spec/_fixtures.js";

const NO_CLOUD = { environmentId: undefined, registryUrl: undefined, cloudSwitchboardUrl: undefined };

describe("studioConfigPath", () => {
  it("is ${userData}/.ph/vetra/studio.config.json, as hosts/connect names it", () => {
    expect(studioConfigPath({}, "/p")).toBe(path.join(path.resolve("/p"), ".ph", "vetra", "studio.config.json"));
    expect(studioConfigPath({ PH_USER_DATA_DIR: "/data" }, "/p")).toBe(
      path.join("/data", ".ph", "vetra", "studio.config.json"),
    );
  });
});

describe("studioConfigFor", () => {
  it("a local Studio: the local API and the Studio's origin, no cloud fields", () => {
    expect(
      studioConfigFor({
        previewServerUrl: "http://127.0.0.1:61234",
        studioUrl: "http://127.0.0.1:8093/",
        studioDriveId: "drive-1",
        config: NO_CLOUD,
        workdir: "/p",
        env: {},
      }),
    ).toEqual({
      previewServerUrl: "http://127.0.0.1:61234",
      studioOrigin: "http://127.0.0.1:8093",
      studioDriveId: "drive-1",
    });
  });

  it("without a Connect member it names no origin (the tab then sends no bearer)", () => {
    expect(
      studioConfigFor({ previewServerUrl: "http://127.0.0.1:1", config: NO_CLOUD, workdir: "/p", env: {} }),
    ).toEqual({ previewServerUrl: "http://127.0.0.1:1" });
  });

  it("a cloud Studio adds its environment, cloud switchboard and registry", () => {
    const config = {
      environmentId: "env-1",
      registryUrl: undefined,
      cloudSwitchboardUrl: "https://switchboard.vetra.io",
    };
    expect(
      studioConfigFor({ previewServerUrl: "http://127.0.0.1:1", config, workdir: "/nowhere", env: {} }),
    ).toMatchObject({
      environmentId: "env-1",
      cloudSwitchboardUrl: "https://switchboard.vetra.io",
      packageRegistryUrl: "https://registry.vetra.io",
    });
    expect(
      studioConfigFor({
        previewServerUrl: "http://127.0.0.1:1",
        config: { ...config, registryUrl: "https://r.example" },
        workdir: "/nowhere",
        env: {},
      }).packageRegistryUrl,
    ).toBe("https://r.example");
    // The environment id from the env counts too.
    expect(
      studioConfigFor({
        previewServerUrl: "http://127.0.0.1:1",
        config: NO_CLOUD,
        workdir: "/nowhere",
        env: { VETRA_ENVIRONMENT_ID: "env-2" },
      }).environmentId,
    ).toBe("env-2");
  });
});

describe("writing and removing it", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-config-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes it whole and removes only its own", () => {
    const file = path.join(dir, ".ph", "vetra", "studio.config.json");
    writeStudioConfig(file, { previewServerUrl: "http://127.0.0.1:1" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ previewServerUrl: "http://127.0.0.1:1" });
    // Another Cli's file (a restart wrote it since): kept.
    removeStudioConfig(file, "http://127.0.0.1:2");
    expect(existsSync(file)).toBe(true);
    removeStudioConfig(file, "http://127.0.0.1:1");
    expect(existsSync(file)).toBe(false);
    // Gone already: nothing to do.
    removeStudioConfig(file, "http://127.0.0.1:1");
  });
});

describe("the preview-server trigger", () => {
  let dir: string;
  const saved = process.env.PH_USER_DATA_DIR;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-config-trigger-"));
    process.env.PH_USER_DATA_DIR = dir;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PH_USER_DATA_DIR;
    else process.env.PH_USER_DATA_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it("listens on an OS port, names it in studio.config.json and removes it at teardown", async () => {
    const connect: ServiceInstanceStatus = {
      serviceId: "connect",
      instanceId: "connect",
      name: "connect",
      status: "ready",
      endpoints: { "endpoints.connect": "http://127.0.0.1:8093/" },
    };
    const state = previewServerTrigger.state!();
    const ctx = {
      state,
      context: { workdir: dir, config: defaultConfig(), log: undefined },
      commandContext: { services: { list: () => [connect] }, on: () => () => {} },
    };
    const trigger = previewServerTrigger as unknown as {
      setup: (c: typeof ctx) => Promise<void>;
      teardown: (c: typeof ctx) => Promise<void>;
    };
    await trigger.setup(ctx);
    try {
      const file = path.join(dir, ".ph", "vetra", "studio.config.json");
      const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      expect(written.previewServerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(written.previewServerUrl).not.toBe("http://127.0.0.1:5180");
      expect(written.studioOrigin).toBe("http://127.0.0.1:8093");
      const res = await fetch(`${written.previewServerUrl}/healthz`);
      expect(await res.json()).toEqual({ ok: true });
      await trigger.teardown(ctx);
      expect(existsSync(file)).toBe(false);
    } finally {
      await trigger.teardown(ctx);
    }
  });

  it("keeps a file another Cli wrote meanwhile", async () => {
    const state = previewServerTrigger.state!();
    const ctx = {
      state,
      context: { workdir: dir, config: defaultConfig(), log: undefined },
      commandContext: { services: { list: () => [] }, on: () => () => {} },
    };
    const trigger = previewServerTrigger as unknown as {
      setup: (c: typeof ctx) => Promise<void>;
      teardown: (c: typeof ctx) => Promise<void>;
    };
    await trigger.setup(ctx);
    const file = path.join(dir, ".ph", "vetra", "studio.config.json");
    writeFileSync(file, JSON.stringify({ previewServerUrl: "http://127.0.0.1:9" }));
    await trigger.teardown(ctx);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ previewServerUrl: "http://127.0.0.1:9" });
  });
});
