import { describe, expect, it } from "vitest";
import { resolveDeployProject } from "./resolveDeployProject.js";
import type { ProjectPackageInfo } from "./useProjectPackageInfo.js";

const pkg: ProjectPackageInfo = { name: "@acme/todo", version: "1.2.0" };

describe("resolveDeployProject", () => {
  it("a publish is the project's deploy, before the package data loads", () => {
    expect(
      resolveDeployProject({ publish: true, callId: "c1" }, undefined),
    ).toBe(true);
  });

  it("an install of the project's package is the project's deploy", () => {
    expect(
      resolveDeployProject({ packageName: "@acme/todo", callId: "c1" }, pkg),
    ).toBe(true);
  });

  it("an install of another package is not", () => {
    expect(
      resolveDeployProject({ packageName: "@other/pkg", callId: "c1" }, pkg),
    ).toBe(false);
    // A project without a readable package.json produces no package.
    expect(
      resolveDeployProject({ packageName: "@acme/todo", callId: "c1" }, null),
    ).toBe(false);
  });

  it("can't tell a package install while the package data is loading", () => {
    expect(
      resolveDeployProject(
        { packageName: "@acme/todo", callId: "c1" },
        undefined,
      ),
    ).toBeNull();
  });
});
