// @vitest-environment happy-dom
import type {
  DocumentDriveDocument,
  Node,
} from "@powerhousedao/shared/document-drive";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { render } from "../test-utils/render.js";
import { file } from "../test-utils/studioFixtures.js";
import { NO_SPECS, PROJECT_FALLBACK_NAME, ProjectHome } from "./ProjectHome.js";
import type { ProjectPackage } from "./useProjectPackage.js";

const hoisted = vi.hoisted(() => ({
  project: undefined as ProjectPackage | undefined,
}));

vi.mock("./useProjectPackage.js", () => ({
  useProjectPackage: () => hoisted.project,
}));
vi.mock("../ChatPane.js", () => ({
  ChatPane: ({ document }: { document: DocumentDriveDocument }) => (
    <div data-chat-pane={document.header.id}>Chat sessions</div>
  ),
}));
vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-in",
    name: undefined,
    hasUser: false,
    signIn: () => {},
    signOut: () => {},
  }),
}));

function driveDoc(nodes: Node[]): DocumentDriveDocument {
  return {
    header: { id: "drive-1", name: "Home" },
    state: { global: { name: "Home", nodes }, local: {} },
  } as unknown as DocumentDriveDocument;
}

function mount(nodes: Node[]) {
  return render(
    <ProjectHome
      drive={driveDoc(nodes)}
      dispatch={() => {}}
      onOpenSettings={() => {}}
    />,
  );
}

beforeEach(() => {
  hoisted.project = undefined;
});

describe("ProjectHome", () => {
  it("names the project with its version, next to the conversations", () => {
    hoisted.project = { name: "@acme/shop", version: "1.0.9" };
    const container = mount([]);
    const header = container.querySelector('[aria-label="Project"]');
    expect(header?.querySelector("h1")?.textContent).toBe("@acme/shop");
    expect(header?.querySelector("[data-project-version]")?.textContent).toBe(
      "1.0.9",
    );
    expect(
      container
        .querySelector('[aria-label="Conversations"] [data-chat-pane]')
        ?.getAttribute("data-chat-pane"),
    ).toBe("drive-1");
    expectNoForbiddenWords(container);
  });

  it("says 'This project' until the name is read", () => {
    const container = mount([]);
    expect(container.querySelector("h1")?.textContent).toBe(
      PROJECT_FALLBACK_NAME,
    );
    expect(container.querySelector("[data-project-version]")).toBeNull();
  });

  it("lists the drive's specifications, read-only, by name", () => {
    const container = mount([
      file("m1", "powerhouse/document-model", "Recipe Box"),
      file("e1", "powerhouse/document-editor", "Card editor"),
      file("s1", "powerhouse/chat-session", "Session 1"),
      {
        ...file("m2", "powerhouse/document-model", "Basket"),
        parentFolder: "f1",
      },
    ]);
    const specs = container.querySelector('[aria-label="Specifications"]');
    const rows = Array.from(specs?.querySelectorAll("[data-spec]") ?? []);
    expect(rows.map((r) => r.getAttribute("data-spec"))).toEqual([
      "m2",
      "e1",
      "m1",
    ]);
    expect(rows[2]?.textContent).toContain("Document model");
    // Read-only: no buttons or links in the list.
    expect(specs?.querySelectorAll("button, a")).toHaveLength(0);
    expect(specs?.textContent).not.toContain(NO_SPECS);
  });

  it("an empty drive says how specifications come", () => {
    const container = mount([]);
    expect(container.textContent).toContain(NO_SPECS);
    expectNoForbiddenWords(container);
  });
});
