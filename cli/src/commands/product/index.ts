import { lazyCommand } from "../../lazy.js";
import { productProgressMeta } from "./meta.js";

export const productCommands = [
  lazyCommand(
    productProgressMeta,
    async () => (await import("./progress.js")).productProgress,
  ),
];
