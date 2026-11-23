import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { removeSpecFromDrive } from "../../helpers/spec-drive-sync.js";
import { findSpec } from "./drive-specs.js";

export const specDelete = defineCommand({
  id: "spec-delete",
  description: "Delete a spec document by name.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Spec to delete — accepts display name, slug, or id (see spec-list).",
      ),
  }),
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
