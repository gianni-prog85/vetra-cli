import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { DOCUMENT_MODEL_TYPE } from "./document-model.js";
import { renderProjected } from "./_helpers.js";
import { contentOperationCount, findSpec } from "./drive-specs.js";
import { specGetMeta } from "./meta.js";

/* Narrow a doc's state down to its latest specification entry. Only doc-model
 * specs have a versioned `specifications` array on state.global; for other doc
 * types, fall back to state.global so --latest is a no-op rather than a crash. */
function pickLatestSpec(state: unknown, documentType: string): unknown {
  if (documentType !== DOCUMENT_MODEL_TYPE) {
    return (state as { global?: unknown }).global ?? state;
  }
  const global = (state as { global?: { specifications?: unknown[] } }).global;
  const specs = global?.specifications;
  if (Array.isArray(specs) && specs.length > 0) return specs[specs.length - 1];
  return global ?? state;
}

const HELP_BY_TYPE: Record<string, string> = {
  [DOCUMENT_MODEL_TYPE]: [
    "  --filter $.global.name                                    model name",
    "  --latest --filter $.modules[*].name                       module names in the latest spec",
    "  --latest --filter \"$.modules[*].operations[?(@.name=='SET_MODEL_NAME')]\"  one operation",
  ].join("\n"),
  "powerhouse/document-editor": [
    "  --filter $.global                                         entire editor config",
    "  --filter $.global.documentTypes                           which doc types this editor handles",
  ].join("\n"),
  "powerhouse/processor": [
    "  --filter $.global                                         entire processor config",
    "  --filter $.global.subscribedDocumentTypes                 documents this processor listens to",
  ].join("\n"),
  "powerhouse/subgraph": [
    "  --filter $.global                                         entire subgraph config",
    "  --filter $.global.schema                                  GraphQL schema",
  ].join("\n"),
};

function buildHelp(documentType: string, name: string): string {
  const typed = HELP_BY_TYPE[documentType];
  const generic =
    "  --filter <jsonpath>                                       project against state (default scope: $.global)";
  const latestNote =
    documentType === DOCUMENT_MODEL_TYPE
      ? "\n  --latest scopes the value (and --filter) to state.global.specifications.at(-1).\n"
      : "\n";
  return [
    `Usage examples for "${name}" (${documentType}):`,
    generic,
    typed ?? "  --filter $.global                                         entire global state",
    latestNote + "Tip: combine with --format toon to compact large results.",
  ].join("\n");
}

export const specGet = defineCommand({
  ...specGetMeta,
  execute: async (input, context) => {
    await projectRoot(context.workdir);
    const { drive, doc } = await findSpec(context, input.name);

    if (!input.full && !input.filter && !input.latest) {
      // The client returns a document without its operations.
      const opsTotal = await contentOperationCount(drive, doc.header.id);
      const summary = `${doc.header.documentType} "${doc.header.name}" — ${opsTotal} operation(s).`;
      return { text: `${summary}\n\n${buildHelp(doc.header.documentType, input.name)}` };
    }

    const value = input.latest
      ? pickLatestSpec(doc.state, doc.header.documentType)
      : doc.state;
    // Default filter scope: $.global (state.global), unless --full (whole state)
    // or --latest (already narrowed to the latest spec entry).
    const filter =
      input.filter ?? (input.latest || input.full ? "$" : "$.global");
    return { text: renderProjected(value, filter, input.format) };
  },
});
