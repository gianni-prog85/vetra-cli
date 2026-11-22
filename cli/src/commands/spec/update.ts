import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  actionInputSchema,
  enrichActionValidationError,
  loadByName,
  normalizeSpecActions,
  resolveActionsInput,
} from "./_helpers.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { studioSignatureMode } from "../../auth/studio-mode.js";
import { applyActions, saveSpec } from "./registry.js";

export const specUpdate = defineCommand({
  id: "spec-update",
  description: "Apply actions to a spec via the document model's reducer.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Spec to update — accepts display name, slug, or id (see spec-list).",
      ),
    actions: z
      .preprocess((v) => {
        /* Tool/MCP callers pass a real array; shell users pass `--actions
         * '[...]'`, which arrives as a JSON-encoded string. Accept both. */
        if (typeof v !== "string") return v;
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return v;
        }
      }, z.array(actionInputSchema))
      .optional()
      .describe(
        "Inline JSON array of actions. Preferred for agent tool calls — no filesystem detour needed.",
      ),
    from: z
      .string()
      .optional()
      .describe(
        "Path to a JSON file containing the actions array. Use for human CLI workflows.",
      ),
  }),
  execute: async (input, context) => {
    const { workdir } = context;
    const drive = await getEmbeddedDrive(context);
    const base = await projectRoot(workdir);
    const doc = await loadByName(base, input.name);
    const { actions, minted } = normalizeSpecActions(
      doc,
      await resolveActionsInput({
        actions: input.actions,
        from: input.from,
      }),
    );
    let next: ReturnType<typeof applyActions>;
    try {
      next = applyActions(doc, actions);
    } catch (err) {
      enrichActionValidationError(err, doc.header.documentType);
    }
    // Docs loaded from disk may omit empty operation scopes entirely.
    const opScopes = next.operations as Partial<
      Record<"global" | "local", unknown[]>
    >;
    const opsCount =
      (opScopes.global?.length ?? 0) + (opScopes.local?.length ?? 0);
    const path = await saveSpec(next, base);
    // Push the updated ops into the Studio drive when the reactor is attached.
    // On a v2-required switchboard the client signs them and the file is
    // rewritten from the signed document.
    if (drive) {
      await applyFsChangesToReactor(
        [path],
        workdir,
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
    let text = `Applied ${actions.length} action(s) to ${next.header.documentType} "${next.header.name}" (now ${opsCount} op(s) total) → ${path}`;
    if (minted.length > 0) {
      /* The agent omitted these creation ids, so it can't know them; list them
       * so a follow-up action can target the entity. */
      text +=
        `\nMinted id(s) — reference these in later actions:\n` +
        minted
          .map((m) => `  ${m.type}${m.label ? ` "${m.label}"` : ""} → ${m.id}`)
          .join("\n");
    }
    return {
      text,
      data: {
        documentId: next.header.id,
        documentType: next.header.documentType,
        name: next.header.name,
      },
    };
  },
});
