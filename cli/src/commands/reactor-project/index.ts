import { reactorProjectBuild } from "./build.js";
import { reactorProjectCheck } from "./check.js";
import { reactorProjectPublish } from "./publish.js";
import { reactorProjectPublishStatus } from "./publish-status.js";
import { previewModelsCommand } from "./models.js";
import { reactorProjectStart } from "./start.js";

// No init: Studio runs inside one project and creates none (`ph init` does).
export const reactorProjectCommands = [
  reactorProjectBuild,
  reactorProjectCheck,
  reactorProjectPublish,
  reactorProjectPublishStatus,
  reactorProjectStart,
  previewModelsCommand,
];
