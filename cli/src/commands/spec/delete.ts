import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { removeSpecFromDrive } from "../../helpers/spec-drive-sync.js";
import { findSpec } from "./drive-specs.js";
import { specDeleteMeta } from "./meta.js";

export const specDelete = defineCommand({
  ...specDeleteMeta,
  execute: async (input, context) => {
    await projectRoot(context.workdir);
    const { embedded, doc } = await findSpec(context, input.name);
    await removeSpecFromDrive(
      embedded.reactor,
      embedded.driveId,
      doc.header.id,
      context.log,
    );
    return { text: `Deleted "${doc.header.name}" (${doc.header.id})` };
  },
});
