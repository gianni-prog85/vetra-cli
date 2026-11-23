import { lazyCommand } from "../../lazy.js";
import {
  previewModelsMeta,
  reactorProjectBuildMeta,
  reactorProjectCheckMeta,
  reactorProjectPublishMeta,
  reactorProjectPublishStatusMeta,
} from "./meta.js";

// No init: Studio runs inside one project and creates none (`ph init` does).
export const reactorProjectCommands = [
  lazyCommand(
    reactorProjectBuildMeta,
    async () => (await import("./build.js")).reactorProjectBuild,
  ),
  lazyCommand(
    reactorProjectCheckMeta,
    async () => (await import("./check.js")).reactorProjectCheck,
  ),
  lazyCommand(
    reactorProjectPublishMeta,
    async () => (await import("./publish.js")).reactorProjectPublish,
  ),
  lazyCommand(
    reactorProjectPublishStatusMeta,
    async () =>
      (await import("./publish-status.js")).reactorProjectPublishStatus,
  ),
  // `reactor-project-start`, `-stop`, `-ps` and `-restart` are the service's
  // own commands (clint adds them): a start on a run that is up returns it.
  lazyCommand(
    previewModelsMeta,
    async () => (await import("./models.js")).previewModelsCommand,
  ),
];
