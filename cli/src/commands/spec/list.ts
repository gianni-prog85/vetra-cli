import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { requireSpecDrive } from "../../helpers/embedded-drive.js";
import { formatColumns } from "./_helpers.js";
import { listDriveSpecs, specDriveOf } from "./drive-specs.js";
import { specListMeta } from "./meta.js";

export const specList = defineCommand({
  ...specListMeta,
  execute: async (input, context) => {
    await projectRoot(context.workdir);
    const drive = specDriveOf(await requireSpecDrive(context));
    const docs = await listDriveSpecs(drive, {
      documentType: input.type,
      category: input.category,
    });
    if (docs.length === 0) {
      return { text: "(no specs)" };
    }
    const rows = docs.map((d) => [
      d.header.name,
      d.header.slug || "—",
      d.header.documentType,
      d.header.id,
    ]);
    return {
      text: formatColumns(rows),
    };
  },
});
