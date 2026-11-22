import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { assertProjectInstalled, projectRoot } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { studioSignatureMode } from "../../auth/studio-mode.js";
import { assertKnownDocumentType, slugify } from "./_helpers.js";
import {
  createSpecDocument,
  isProductSpecType,
  listSpecTypes,
  saveSpec,
} from "./registry.js";
import { actionReference } from "./schema.js";

export const specCreate = defineCommand({
  id: "spec-create",
  description:
    "Create a new spec document under the project's specs/ (product and project specs alike).",
  inputSchema: z.object({
    type: z
      .string()
      .default("")
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name and (kebab-cased) as the filename.",
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "If set, create the doc in-memory only — don't persist to specs/.",
      ),
  }),
  execute: async (input, context) => {
    const { workdir } = context;
    requireOption(input.type, "type", `Valid types: ${listSpecTypes().join(", ")}`);
    assertKnownDocumentType(input.type);
    // Every spec lives in the project (the workdir). A project spec generates
    // code, so a project never installed can't take one.
    const base = await projectRoot(workdir);
    if (!isProductSpecType(input.type)) await assertProjectInstalled(base);
    // The spec is created the way the Studio switchboard creates documents;
    // a v2-required one is then created through the reactor and mirrored back
    // signed. Without the reactor the file is legacy, and the sync signs it.
    const drive = await getEmbeddedDrive(context);
    const signatureMode = drive
      ? await studioSignatureMode(drive.reactor, context.config, context.log)
      : "legacy";
    const doc = createSpecDocument(input.type, {
      name: input.name,
      signaturePolicy: signatureMode,
    });
    /* `createDocument` only seeds `name`; populate slug from it so the doc
     * has a stable short handle alongside its display name and id. */
    doc.header.slug = slugify(input.name);
    // A project spec's action shapes ride along, so the agent's spec-update
    // calls need no spec-schema lookup per action (staging: 5–10 per spec).
    // Not for product specs: Plan creates several, and their listings (2–3.5k
    // chars each) would add ~5–6k tokens against the input-token cap.
    const reference = isProductSpecType(input.type)
      ? ""
      : actionReference(input.type);
    const withReference = (text: string) =>
      reference ? `${text}\n\n${reference}` : text;
    if (input.dryRun) {
      return {
        text: withReference(
          `Created ${doc.header.documentType} "${doc.header.name}" (in-memory, not saved).`,
        ),
      };
    }
    const path = await saveSpec(doc, base);
    // When a reactor is already running (daemon), push the new spec straight
    // into the embedded drive so Studio reflects it without the watcher. In a
    // signed Studio this is the only write path (signed, derived id).
    if (drive) {
      await applyFsChangesToReactor(
        [path],
        workdir,
        drive.reactor,
        drive.driveId,
        context.log,
        undefined,
        { signatureMode },
      );
    }
    return {
      text: withReference(
        `Created ${doc.header.documentType} "${doc.header.name}"  id: ${doc.header.id}\n${path}`,
      ),
      data: {
        documentId: doc.header.id,
        documentType: doc.header.documentType,
        name: doc.header.name,
      },
    };
  },
});
