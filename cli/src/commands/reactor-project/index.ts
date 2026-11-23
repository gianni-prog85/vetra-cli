import { lazyCommand } from "../../lazy.js";
import {
  previewModelsMeta,
  reactorProjectBuildMeta,
  reactorProjectCheckMeta,
  reactorProjectPublishMeta,
  reactorProjectPublishStatusMeta,
  reactorProjectStartMeta,
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
  lazyCommand(
    reactorProjectStartMeta,
    async () => (await import("./start.js")).reactorProjectStart,
  ),
  lazyCommand(
    previewModelsMeta,
    async () => (await import("./models.js")).previewModelsCommand,
  ),
];
