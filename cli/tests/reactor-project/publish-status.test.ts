import { describe, expect, it } from "vitest";

import { reactorProjectPublishStatus } from "../../src/commands/reactor-project/publish-status.js";

describe("reactor-project-publish-status command shape", () => {
  it("exposes the expected id and input fields", () => {
    expect(reactorProjectPublishStatus.id).toBe("reactor-project-publish-status");
    // The project is the workdir: no project name to pass.
    expect(reactorProjectPublishStatus.inputSchema.shape).not.toHaveProperty("name");
    expect(reactorProjectPublishStatus.inputSchema.shape).toHaveProperty("version");
    expect(reactorProjectPublishStatus.inputSchema.shape).toHaveProperty("registry");
  });
});
