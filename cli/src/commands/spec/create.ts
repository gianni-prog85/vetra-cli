import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { assertProjectInstalled, projectRoot } from "../../helpers/project.js";
import { requireSpecDrive } from "../../helpers/embedded-drive.js";
import { ensureFileNode, serialized } from "../../helpers/spec-drive-sync.js";
import { studioSignatureMode } from "../../auth/studio-mode.js";
import { assertKnownDocumentType, slugify } from "./_helpers.js";
import { specDriveOf } from "./drive-specs.js";
import {
  createSpecDocument,
  isProductSpecType,
  listSpecTypes,
} from "./registry.js";
import { actionReference } from "./schema.js";

export const specCreate = defineCommand({
  id: "spec-create",
  description:
    "Create a new spec document in the Studio drive (product and project specs alike).",
  inputSchema: z.object({
    type: z
      .string()
      .default("")
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name and (kebab-cased) as its slug.",
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "If set, create the doc in-memory only — don't add it to the drive.",
      ),
  }),
  execute: async (input, context) => {
    const { workdir } = context;
    requireOption(input.type, "type", `Valid types: ${listSpecTypes().join(", ")}`);
    assertKnownDocumentType(input.type);
    // A project spec generates code, so a project never installed can't take one.
    const base = await projectRoot(workdir);
    if (!isProductSpecType(input.type)) await assertProjectInstalled(base);
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
      const draft = createSpecDocument(input.type, { name: input.name });
      return {
        text: withReference(
          `Created ${draft.header.documentType} "${draft.header.name}" (in-memory, not saved).`,
        ),
      };
    }
    // Created the way the Studio switchboard creates documents: on a
    // v2-required one the client signs the creation.
    const embedded = await requireSpecDrive(context);
    const drive = specDriveOf(embedded);
    const doc = createSpecDocument(input.type, {
      name: input.name,
      signaturePolicy: await studioSignatureMode(
        embedded.reactor,
        context.config,
        context.log,
      ),
    });
    /* `createDocument` only seeds `name`; populate slug from it so the doc
     * has a stable short handle alongside its display name and id. */
    doc.header.slug = slugify(input.name);
    await serialized(async () => {
      await drive.client.create(doc);
      await ensureFileNode(
        drive.client,
        drive.driveId,
        {
          id: doc.header.id,
          name: doc.header.name,
          documentType: doc.header.documentType,
        },
        context.log,
      );
    });
    return {
      text: withReference(
        `Created ${doc.header.documentType} "${doc.header.name}"  id: ${doc.header.id}`,
      ),
      data: {
        documentId: doc.header.id,
        documentType: doc.header.documentType,
        name: doc.header.name,
      },
    };
  },
});
