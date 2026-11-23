import { basename, dirname } from "node:path";
import { baseSaveToFile } from "document-model/node";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { studioSignatureMode } from "../../auth/studio-mode.js";
import { extractSpecFiles } from "../../generation/run.js";
import { loadSpecDocument } from "./registry.js";
import { slugify } from "./_helpers.js";

const typeSchema = z
  .enum(["all", "document-model", "editor", "app", "processor", "subgraph"])
  .default("all")
  .describe(
    'Which modules to extract. "all" (default) covers every type; or pick one.',
  );

// The extract doesn't seed header.slug; restore the slug invariant
// spec-create establishes, rewriting the file in place (same path).
async function backfillSlug(filePath: string): Promise<void> {
  const doc = await loadSpecDocument(filePath);
  if (doc.header.slug || !doc.header.name) return;
  doc.header.slug = slugify(doc.header.name);
  const parts = basename(filePath).split("."); // <name>.<ext>.phd
  if (parts.length < 3) return;
  await baseSaveToFile(doc, dirname(filePath), parts.at(-2)!, parts.slice(0, -2).join("."));
}

export const specExtract = defineCommand({
  id: "spec-extract",
  description: "Extract specs by reverse-engineering existing package source.",
  inputSchema: z.object({
    type: typeSchema,
  }),
  execute: async (input, context) => {
    const { workdir } = context;
    const drive = await getEmbeddedDrive(context);
    const base = await projectRoot(workdir);

    // The engine in `cli/src/generation` writes a spec for each existing
    // module into specs/, in this process.
    const written: string[] = [];
    let failure: Error | undefined;
    try {
      await extractSpecFiles(input.type, base, (path) => written.push(path));
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    // Sync what was written before surfacing a failure, so a partial extract
    // isn't lost from the drive.
    for (const filePath of written) await backfillSlug(filePath);

    // The extracted files are legacy; on a v2-required switchboard the sync
    // makes signed documents of them.
    if (drive && written.length > 0) {
      await applyFsChangesToReactor(
        written,
        base,
        drive.reactor,
        drive.driveId,
        context.log,
        undefined,
        {
          signatureMode: await studioSignatureMode(
            drive.reactor,
            context.config,
            context.log,
          ),
        },
      );
    }

    if (failure) throw failure;

    return {
      text:
        written.length === 0
          ? "(no specs extracted)"
          : `Wrote ${written.length} spec(s):\n${written.join("\n")}`,
    };
  },
});
