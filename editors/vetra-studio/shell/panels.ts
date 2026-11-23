/**
 * The Studio page's panels: which are open, and the address of a panel in
 * its own tab.
 */

export const PANELS = ["specs", "test", "agent"] as const;
export type PanelId = (typeof PANELS)[number];
export type OpenPanels = Readonly<Record<PanelId, boolean>>;

export const PANEL_LABELS: Record<PanelId, string> = {
  specs: "Specs",
  test: "Test / Preview",
  agent: "Agent",
};

/** Test / Preview has nothing to show yet, so it starts closed. */
export const DEFAULT_PANELS: OpenPanels = {
  specs: true,
  test: false,
  agent: true,
};

export const PANELS_STORAGE_KEY = "vetra-studio:panels";

export function parsePanels(raw: string | null): OpenPanels {
  if (raw === null) return DEFAULT_PANELS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_PANELS;
    const stored = value as Record<string, unknown>;
    const read = (id: PanelId) =>
      typeof stored[id] === "boolean" ? stored[id] : DEFAULT_PANELS[id];
    return { specs: read("specs"), test: read("test"), agent: read("agent") };
  } catch {
    return DEFAULT_PANELS;
  }
}

export function readPanels(): OpenPanels {
  try {
    return parsePanels(window.localStorage.getItem(PANELS_STORAGE_KEY));
  } catch {
    return DEFAULT_PANELS;
  }
}

export function writePanels(panels: OpenPanels): void {
  try {
    window.localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(panels));
  } catch {
    // Blocked storage: the choice lasts for this visit only.
  }
}

export function togglePanel(panels: OpenPanels, id: PanelId): OpenPanels {
  return { ...panels, [id]: !panels[id] };
}

export function openCount(panels: OpenPanels): number {
  return PANELS.filter((id) => panels[id]).length;
}

/** Connect drops its own sidebar for a page opened with this parameter, and
 *  keeps the parameter across navigation. */
const OWN_TAB_PARAM = "embed";
const PANEL_PARAM = "panel";

/** What a tab shows: the Studio page, or one panel on its own. */
export type TabView = "studio" | "specs" | "test";

export function tabView(search: string): TabView {
  const params = new URLSearchParams(search);
  if (params.get(OWN_TAB_PARAM) !== "1") return "studio";
  return params.get(PANEL_PARAM) === "test" ? "test" : "specs";
}

/** A panel's own-tab address for the page at `pathname`. Specs keeps the
 *  open document (the path); Test is the drive's own page. */
export function ownTabHref(
  panel: "specs" | "test",
  pathname: string,
  drivePath: string,
): string {
  return panel === "specs"
    ? `${pathname}?${OWN_TAB_PARAM}=1`
    : `${drivePath}?${OWN_TAB_PARAM}=1&${PANEL_PARAM}=test`;
}

/** The drive's page: the first two segments of a `/d/<drive>/<node>` path. */
export function drivePathOf(pathname: string): string {
  const [, scope, drive] = pathname.split("/");
  return scope && drive ? `/${scope}/${drive}` : pathname;
}
