import { lazyCommand } from "../../lazy.js";
import {
  specCreateMeta,
  specDeleteMeta,
  specExtractMeta,
  specGenerateMeta,
  specGetMeta,
  specListMeta,
  specSchemaListMeta,
  specSchemaMeta,
  specUpdateMeta,
} from "./meta.js";

export const specCommands = [
  lazyCommand(specListMeta, async () => (await import("./list.js")).specList),
  lazyCommand(specGetMeta, async () => (await import("./get.js")).specGet),
  lazyCommand(
    specCreateMeta,
    async () => (await import("./create.js")).specCreate,
  ),
  lazyCommand(
    specUpdateMeta,
    async () => (await import("./update.js")).specUpdate,
  ),
  lazyCommand(
    specDeleteMeta,
    async () => (await import("./delete.js")).specDelete,
  ),
  lazyCommand(
    specExtractMeta,
    async () => (await import("./extract.js")).specExtract,
  ),
  lazyCommand(
    specGenerateMeta,
    async () => (await import("./generate.js")).specGenerate,
  ),
  lazyCommand(
    specSchemaListMeta,
    async () => (await import("./schema-list.js")).specSchemaList,
  ),
  lazyCommand(
    specSchemaMeta,
    async () => (await import("./schema.js")).specSchema,
  ),
];
