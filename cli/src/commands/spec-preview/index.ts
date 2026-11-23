import { lazyCommand } from "../../lazy.js";
import {
  specPreviewCreateDriveMeta,
  specPreviewCreateMeta,
  specPreviewDeleteMeta,
  specPreviewGetMeta,
  specPreviewListMeta,
  specPreviewShowMeta,
  specPreviewUpdateMeta,
} from "./meta.js";

export const specPreviewCommands = [
  lazyCommand(
    specPreviewListMeta,
    async () => (await import("./list.js")).specPreviewList,
  ),
  lazyCommand(
    specPreviewGetMeta,
    async () => (await import("./get.js")).specPreviewGet,
  ),
  lazyCommand(
    specPreviewCreateMeta,
    async () => (await import("./create.js")).specPreviewCreate,
  ),
  lazyCommand(
    specPreviewCreateDriveMeta,
    async () => (await import("./create-drive.js")).specPreviewCreateDrive,
  ),
  lazyCommand(
    specPreviewUpdateMeta,
    async () => (await import("./update.js")).specPreviewUpdate,
  ),
  lazyCommand(
    specPreviewDeleteMeta,
    async () => (await import("./delete.js")).specPreviewDelete,
  ),
  lazyCommand(
    specPreviewShowMeta,
    async () => (await import("./show.js")).specPreviewShow,
  ),
];
