import { lazyCommand } from "../../lazy.js";
import { whoamiMeta } from "./meta.js";

export const authCommands = [
  lazyCommand(whoamiMeta, async () => (await import("./whoami.js")).whoami),
];
