import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANELS,
  drivePathOf,
  openCount,
  ownTabHref,
  parsePanels,
  tabView,
  togglePanel,
} from "./panels.js";

describe("panels", () => {
  it("starts with Specs and Agent open", () => {
    expect(DEFAULT_PANELS).toEqual({ specs: true, test: false, agent: true });
    expect(parsePanels(null)).toBe(DEFAULT_PANELS);
  });

  it("reads a stored choice and fills what it lacks from the default", () => {
    expect(parsePanels('{"specs":false,"test":true,"agent":false}')).toEqual({
      specs: false,
      test: true,
      agent: false,
    });
    expect(parsePanels('{"agent":false,"specs":"yes"}')).toEqual({
      specs: true,
      test: false,
      agent: false,
    });
  });

  it("falls back to the default on anything unreadable", () => {
    expect(parsePanels("not json")).toBe(DEFAULT_PANELS);
    expect(parsePanels("null")).toBe(DEFAULT_PANELS);
    expect(parsePanels("3")).toBe(DEFAULT_PANELS);
  });

  it("toggles one panel and counts the open ones", () => {
    const next = togglePanel(DEFAULT_PANELS, "test");
    expect(next).toEqual({ specs: true, test: true, agent: true });
    expect(DEFAULT_PANELS.test).toBe(false);
    expect(openCount(next)).toBe(3);
    expect(openCount({ specs: false, test: false, agent: false })).toBe(0);
  });
});

describe("own tabs", () => {
  it("the Studio page is any address without the own-tab parameter", () => {
    expect(tabView("")).toBe("studio");
    expect(tabView("?panel=test")).toBe("studio");
    expect(tabView("?embed=0")).toBe("studio");
  });

  it("an own tab is Specs unless it names Test", () => {
    expect(tabView("?embed=1")).toBe("specs");
    expect(tabView("?embed=1&panel=test")).toBe("test");
    expect(tabView("?embed=1&panel=agent")).toBe("specs");
  });

  it("Specs keeps the open document; Test is the drive's page", () => {
    expect(ownTabHref("specs", "/d/studio/order", "/d/studio")).toBe(
      "/d/studio/order?embed=1",
    );
    expect(ownTabHref("test", "/d/studio/order", "/d/studio")).toBe(
      "/d/studio?embed=1&panel=test",
    );
    expect(tabView(ownTabHref("test", "/d/studio", "/d/studio").slice(9))).toBe(
      "test",
    );
  });

  it("finds the drive's page in a document's path", () => {
    expect(drivePathOf("/d/studio/order")).toBe("/d/studio");
    expect(drivePathOf("/d/studio")).toBe("/d/studio");
    expect(drivePathOf("/")).toBe("/");
  });
});
