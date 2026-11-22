/**
 * The Renown the Studio verifies owner sign-ins on.
 */
import { describe, it, expect, vi } from "vitest";
import { resolveStudioRenownUrl } from "../../src/cloud/config.js";

const STAGING = "https://renown-staging.vetra.io";
const OTHER = "https://renown.example";

describe("resolveStudioRenownUrl", () => {
  it.each([
    ["neither set", undefined, undefined, undefined],
    ["only cloudRenownUrl", undefined, STAGING, STAGING],
    ["only RENOWN_URL", OTHER, undefined, OTHER],
    ["both, differing (RENOWN_URL wins)", OTHER, STAGING, OTHER],
  ] as const)("%s", (_, env, cloud, expected) => {
    expect(resolveStudioRenownUrl(env, cloud, { warn: vi.fn() })).toBe(expected);
  });

  it("warns naming both URLs when they differ", () => {
    const warn = vi.fn();
    resolveStudioRenownUrl(OTHER, STAGING, { warn });
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain(OTHER);
    expect(warning).toContain(STAGING);
    resolveStudioRenownUrl(OTHER, OTHER, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
