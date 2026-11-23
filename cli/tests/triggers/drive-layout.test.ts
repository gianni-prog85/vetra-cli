import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACKAGE_DRIVE_FOLDERS } from "@powerhousedao/vetra/drive-layout";
import { driveLayoutTrigger } from "../../src/triggers/drive-layout.js";
import { makeSpecDrive, type SpecDriveFixture } from "../spec/_fixtures.js";

type PollCtx = Parameters<typeof driveLayoutTrigger.poll>[0];

describe("drive-layout trigger", () => {
  let drive: SpecDriveFixture;
  beforeEach(async () => {
    drive = await makeSpecDrive();
  });
  afterEach(async () => {
    await drive.close();
  });

  function makeCtx(reactor: () => Promise<unknown>) {
    const warnings: string[] = [];
    const ctx = {
      state: driveLayoutTrigger.state!(),
      context: { workdir: "unused", log: { warn: (m: string) => warnings.push(m) } },
      reactor,
    } as never as PollCtx;
    return { ctx, warnings };
  }

  const folders = async () => (await drive.nodes()).filter((n) => n.kind === "folder");

  it("adds the layout's folders on the first poll, once", async () => {
    let reads = 0;
    const { ctx, warnings } = makeCtx(async () => {
      reads += 1;
      return { client: drive.module.client, driveId: drive.driveId };
    });

    await driveLayoutTrigger.poll(ctx);
    expect(await folders()).toHaveLength(PACKAGE_DRIVE_FOLDERS.length);

    await driveLayoutTrigger.poll(ctx);
    expect(reads).toBe(1);
    expect(await folders()).toHaveLength(PACKAGE_DRIVE_FOLDERS.length);
    expect(warnings).toEqual([]);
  });

  it("waits for a drive to reach", async () => {
    const reach: { reactor?: unknown } = {};
    const { ctx } = makeCtx(async () => reach.reactor);

    await driveLayoutTrigger.poll(ctx);
    expect(await folders()).toHaveLength(0);

    reach.reactor = { client: drive.module.client, personalDriveId: drive.driveId };
    await driveLayoutTrigger.poll(ctx);
    expect(await folders()).toHaveLength(PACKAGE_DRIVE_FOLDERS.length);
  });

  it("warns and moves on when the drive refuses the folders", async () => {
    const { ctx, warnings } = makeCtx(async () => ({
      client: {
        get: async () => ({ state: { global: { nodes: [] } } }),
        execute: async () => {
          throw new Error("refused");
        },
      },
      driveId: "d1",
    }));

    await driveLayoutTrigger.poll(ctx);
    await driveLayoutTrigger.poll(ctx);

    expect(warnings).toEqual(["[drive-layout] not applied: refused"]);
  });
});
