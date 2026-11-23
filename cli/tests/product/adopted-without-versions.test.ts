/** The cases of the agent's auto-launch gate. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StudioProductState } from "document-models/studio-product";
import { adoptedWithoutVersions } from "../../src/product/upgrade-existing.js";

const CASES = fileURLToPath(
  new URL("./adopted-without-versions.cases.json", import.meta.url),
);
const { cases } = JSON.parse(readFileSync(CASES, "utf-8")) as {
  cases: { name: string; state: unknown; expected: boolean }[];
};

describe("adoptedWithoutVersions", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(5);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(adoptedWithoutVersions(c.state as StudioProductState)).toBe(c.expected);
  });
});
