import { describe, expect, it } from "vitest";
import { LAYER_STYLE, pinExternalPackagesLayer } from "../../src/lifecycle/connect-layer-order.js";

const BUNDLE =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/index.css"></head><body></body></html>';

describe("pinExternalPackagesLayer", () => {
  it("declares the layer first in <head>, before any stylesheet", () => {
    const pinned = pinExternalPackagesLayer(BUNDLE)!;
    expect(pinned.startsWith(`<!doctype html><html><head>${LAYER_STYLE}<meta`)).toBe(true);
    expect(pinned.indexOf(LAYER_STYLE)).toBeLessThan(pinned.indexOf("stylesheet"));
  });

  it("is idempotent: a second pass declares it once", () => {
    const once = pinExternalPackagesLayer(BUNDLE)!;
    const twice = pinExternalPackagesLayer(once)!;
    expect(twice).toBe(once);
    expect(twice.split("@layer external-packages").length - 1).toBe(1);
  });

  it("refuses a page without <head>", () => {
    expect(pinExternalPackagesLayer("<html><body></body></html>")).toBeNull();
  });
});
