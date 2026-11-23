// @vitest-environment happy-dom
import type {
  DocumentDriveDocument,
  Node,
} from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { button, click, render } from "../test-utils/render.js";
import {
  PRODUCT_ID,
  SESSION_ID,
  buildingOps,
  chatDoc,
  file,
  productDoc,
} from "../test-utils/studioFixtures.js";
import { LABS_SCREENS } from "./labsScreens.js";
import { PANELS_STORAGE_KEY } from "./panels.js";
import {
  ALL_CLOSED,
  PREVIEW_NOT_AVAILABLE,
  StudioShell,
  TEST_NOT_AVAILABLE,
} from "./StudioShell.js";

type ExplorerProps = {
  packageName?: string;
  pageImages?: Record<string, string>;
  labsUrl?: string;
  createDocument?: (input: {
    name: string;
    documentType: string;
  }) => Promise<unknown>;
  children?: ReactNode;
};

const hoisted = vi.hoisted(() => ({
  documents: undefined as PHDocument[] | undefined,
  explorer: undefined as ExplorerProps | undefined,
  added: [] as string[][],
}));

vi.mock("@powerhousedao/vetra/editors/vetra-explorer", () => ({
  VetraExplorer: (props: ExplorerProps) => {
    hoisted.explorer = props;
    return <div data-explorer>{props.children}</div>;
  },
}));
vi.mock("../addAgentWritableDocument.js", () => ({
  addAgentWritableDocument: (...args: string[]) => {
    hoisted.added.push(args);
    return Promise.resolve(undefined);
  },
}));
vi.mock("../hooks/useDriveDocuments.js", () => ({
  useDriveDocuments: () => hoisted.documents,
}));
vi.mock("../ChatPane.js", () => ({
  ChatPane: () => <div>Chat sessions</div>,
}));
vi.mock("./useProjectPackage.js", () => ({
  useProjectPackage: () => ({ name: "@acme/shop", version: "1.0.9" }),
}));
vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-in",
    name: undefined,
    hasUser: true,
    signIn: () => {},
    signOut: () => {},
  }),
}));
vi.mock("../settings/SettingsDialog.js", () => ({
  SettingsDialog: () => <div role="dialog">Settings dialog</div>,
}));
vi.mock("../permission/PublishPermissionModal.js", () => ({
  PublishPermissionModal: () => null,
}));
vi.mock("../debug/ProductDebugPanel.js", () => ({
  ProductDebugPanel: () => null,
  isProductDebugEnabled: () => false,
}));

function driveDoc(nodes: Node[]): DocumentDriveDocument {
  return {
    header: { id: "drive-1", name: "Studio" },
    state: { global: { name: "Studio", nodes }, local: {} },
  } as unknown as DocumentDriveDocument;
}

const SESSION = file(SESSION_ID, "powerhouse/chat-session");
const explorerProps = (): ExplorerProps => hoisted.explorer ?? {};

function shell(children?: ReactNode, labsUrl?: string) {
  return render(
    <StudioShell
      document={driveDoc([SESSION])}
      dispatch={() => {}}
      labsUrl={labsUrl}
    >
      {children}
    </StudioShell>,
  );
}

const panel = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-panel="${id}"]`);
const toggle = (container: HTMLElement, id: string) =>
  container.querySelector(`header [data-panel-toggle="${id}"]`);
const openPanels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-panel]")).map((el) =>
    el.getAttribute("data-panel"),
  );

beforeEach(() => {
  hoisted.documents = [chatDoc(SESSION_ID, 1)];
  hoisted.explorer = undefined;
  hoisted.added = [];
  window.localStorage.clear();
  window.history.replaceState({}, "", "/d/studio");
});

describe("StudioShell", () => {
  it("waits for the drive before showing the page", () => {
    hoisted.documents = undefined;
    const container = shell();
    expect(container.textContent).toContain("Opening your Studio…");
    expect(container.querySelector("[data-panel]")).toBeNull();
  });

  it("opens on Specs and Agent under the bar with the project", () => {
    const container = shell();
    const bar = container.querySelector('header[aria-label="Vetra Studio"]');
    expect(bar?.textContent).toContain("Vetra Studio");
    expect(bar?.querySelector("[data-project-name]")?.textContent).toBe(
      "@acme/shop",
    );
    expect(bar?.querySelector("[data-project-version]")?.textContent).toBe(
      "1.0.9",
    );
    expect(openPanels(container)).toEqual(["specs", "agent"]);
    expect(toggle(container, "specs")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(toggle(container, "test")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(toggle(container, "test")?.textContent).toBe("Test / Preview");
    expect(panel(container, "agent")?.textContent).toContain("Chat sessions");
    expect(button(container, "Account")).toBeDefined();
  });

  it("hands the explorer the project, the Labs screens and its create", async () => {
    shell();
    expect(explorerProps().packageName).toBe("@acme/shop");
    expect(explorerProps().pageImages).toBe(LABS_SCREENS);
    await explorerProps().createDocument?.({
      name: "Order",
      documentType: "powerhouse/document-model",
    });
    expect(hoisted.added).toEqual([
      ["drive-1", "Order", "powerhouse/document-model"],
    ]);
  });

  it("shows the open document's editor in Specs", () => {
    const container = shell(<div>Order editor</div>);
    expect(
      panel(container, "specs")?.querySelector("[data-explorer]")?.textContent,
    ).toBe("Order editor");
  });

  it("a drive with a product document shows the same panels, no step strip", () => {
    hoisted.documents = [productDoc(...buildingOps()), chatDoc(SESSION_ID, 1)];
    const container = render(
      <StudioShell
        document={driveDoc([file(PRODUCT_ID, "vetra/studio-product"), SESSION])}
        dispatch={() => {}}
      />,
    );
    expect(openPanels(container)).toEqual(["specs", "agent"]);
    expect(container.querySelector('[aria-label="Steps"]')).toBeNull();
    expect(container.querySelector("[data-step]")).toBeNull();
    expect(container.querySelector('[aria-label="Story"]')).toBeNull();
  });

  it("a toggle opens and closes its panel and the choice is kept", () => {
    const container = shell();
    click(toggle(container, "test"));
    expect(openPanels(container)).toEqual(["specs", "test", "agent"]);
    click(toggle(container, "specs"));
    expect(openPanels(container)).toEqual(["test", "agent"]);
    expect(
      JSON.parse(window.localStorage.getItem(PANELS_STORAGE_KEY) ?? "{}"),
    ).toEqual({ specs: false, test: true, agent: true });

    // The next visit opens the same panels.
    expect(openPanels(shell())).toEqual(["test", "agent"]);
  });

  it("each panel closes from its own header", () => {
    const container = shell();
    click(toggle(container, "test"));
    click(button(container, "Close Test / Preview"));
    click(button(container, "Close Specs"));
    expect(openPanels(container)).toEqual(["agent"]);
    click(button(container, "Close Agent"));
    expect(openPanels(container)).toEqual([]);
  });

  it("with all panels closed it says so and offers the three again", () => {
    const container = shell();
    click(toggle(container, "specs"));
    click(toggle(container, "agent"));
    const empty = container.querySelector('[data-panels="none"]');
    expect(empty?.textContent).toContain(ALL_CLOSED);
    expect(
      Array.from(empty?.querySelectorAll("button") ?? []).map(
        (b) => b.textContent,
      ),
    ).toEqual(["Specs", "Test / Preview", "Agent"]);
    click(empty?.querySelector('[data-panel-toggle="agent"]'));
    expect(openPanels(container)).toEqual(["agent"]);
  });

  it("Test / Preview says it is not available yet, for both", () => {
    const container = shell();
    click(toggle(container, "test"));
    const test = panel(container, "test");
    expect(test?.textContent).toContain(TEST_NOT_AVAILABLE);
    click(
      test?.querySelector('[aria-label="Test or Preview"] button:last-child'),
    );
    expect(test?.textContent).toContain(PREVIEW_NOT_AVAILABLE);
    expect(test?.textContent).not.toContain(TEST_NOT_AVAILABLE);
  });

  it("Specs and Test link to a tab of their own; Agent has none", () => {
    window.history.replaceState({}, "", "/d/studio/order");
    const container = shell(<div>Order editor</div>);
    click(toggle(container, "test"));
    const link = (id: string) =>
      panel(container, id)?.querySelector("header a");
    expect(link("specs")?.getAttribute("href")).toBe("/d/studio/order?embed=1");
    expect(link("specs")?.getAttribute("target")).toBe("_blank");
    expect(link("test")?.getAttribute("href")).toBe(
      "/d/studio?embed=1&panel=test",
    );
    expect(link("agent")).toBeNull();
  });

  it("Agent keeps 420 px beside a panel of at least 640 px, and fills alone", () => {
    const container = shell();
    expect(panel(container, "agent")?.className).toContain("w-[420px]");
    expect(panel(container, "specs")?.className).toContain("min-w-[640px]");
    click(toggle(container, "specs"));
    expect(panel(container, "agent")?.className).not.toContain("w-[420px]");
    expect(panel(container, "agent")?.className).toContain("flex-1");
  });

  it("the account menu opens Settings", () => {
    const container = shell();
    click(button(container, "Account"));
    click(button(container, "Settings"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe(
      "Settings dialog",
    );
  });

  it("links to Vetra Labs only when it has an address", () => {
    expect(
      shell().querySelector('header[aria-label="Vetra Studio"] a'),
    ).toBeNull();
    const container = shell(undefined, "https://labs.example/p");
    const link = container.querySelector('header[aria-label="Vetra Studio"] a');
    expect(link?.textContent).toBe("Open in Vetra Labs ↗");
    expect(link?.getAttribute("href")).toBe("https://labs.example/p");
    expect(explorerProps().labsUrl).toBe("https://labs.example/p");
  });

  it("a spec document in its own tab is the editor only", () => {
    window.history.replaceState({}, "", "/d/studio/order?embed=1");
    const container = shell(<div>Order editor</div>);
    expect(container.textContent).toBe("Order editor");
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("[data-explorer]")).toBeNull();
    expect(container.querySelector("[data-panel]")).toBeNull();
  });

  it("a Specs tab with no document open is the explorer without the bar", () => {
    window.history.replaceState({}, "", "/d/studio?embed=1");
    const container = shell();
    expect(container.querySelector("[data-explorer]")).not.toBeNull();
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("[data-panel]")).toBeNull();
  });

  it("Test in its own tab is the Test / Preview page without the bar", () => {
    window.history.replaceState({}, "", "/d/studio?embed=1&panel=test");
    const container = shell();
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("[data-panel]")).toBeNull();
    expect(container.textContent).toContain(TEST_NOT_AVAILABLE);
  });
});
