import { defineCommand } from "../../framework.js";
import { formatColumns } from "./_helpers.js";
import { specSchemaListMeta } from "./meta.js";
import { listSpecModels } from "./registry.js";

export const specSchemaList = defineCommand({
  ...specSchemaListMeta,
  execute: async () => {
    const models = listSpecModels();
    if (models.length === 0) {
      return { text: "(no schemas registered)" };
    }
    const rows = models.map((m) => [m.type, m.name, m.description]);
    return {
      text: formatColumns(rows),
    };
  },
});
