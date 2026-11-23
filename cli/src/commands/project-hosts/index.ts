import { lazyCommand } from "../../lazy.js";
import {
  projectHostStartMeta,
  projectHostStopMeta,
  projectHostsListMeta,
} from "./meta.js";

export const projectHostCommands = [
  lazyCommand(
    projectHostsListMeta,
    async () => (await import("./commands.js")).projectHostsList,
  ),
  lazyCommand(
    projectHostStartMeta,
    async () => (await import("./commands.js")).projectHostStart,
  ),
  lazyCommand(
    projectHostStopMeta,
    async () => (await import("./commands.js")).projectHostStop,
  ),
];
