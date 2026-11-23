import type { StagePageId } from "@powerhousedao/vetra/editors/vetra-explorer";

/**
 * The Vetra Labs screenshot behind each Build and Deploy placeholder page.
 * Studio's Connect serves them (`runner.serveFiles` in `hosts/connect`).
 */
export const LABS_SCREENS: Record<StagePageId, string> = {
  versions: "/vetra-labs/versions.jpg",
  packages: "/vetra-labs/packages.jpg",
  images: "/vetra-labs/images.jpg",
  installers: "/vetra-labs/installers.jpg",
  environments: "/vetra-labs/environments.jpg",
  environment: "/vetra-labs/environment.jpg",
};
