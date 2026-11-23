import { lazyCommand } from "../../lazy.js";
import {
  deployEnvironmentCreateMeta,
  deployEnvironmentGetMeta,
  deployEnvironmentListMeta,
  deployEnvironmentUpdateMeta,
  deployEnvironmentWaitMeta,
} from "./meta.js";

export const deployCommands = [
  lazyCommand(
    deployEnvironmentListMeta,
    async () => (await import("./list.js")).deployEnvironmentList,
  ),
  lazyCommand(
    deployEnvironmentGetMeta,
    async () => (await import("./get.js")).deployEnvironmentGet,
  ),
  lazyCommand(
    deployEnvironmentCreateMeta,
    async () => (await import("./create.js")).deployEnvironmentCreate,
  ),
  lazyCommand(
    deployEnvironmentUpdateMeta,
    async () => (await import("./update.js")).deployEnvironmentUpdate,
  ),
  lazyCommand(
    deployEnvironmentWaitMeta,
    async () => (await import("./wait.js")).deployEnvironmentWait,
  ),
];
