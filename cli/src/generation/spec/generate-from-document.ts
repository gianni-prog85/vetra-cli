/**
 * Document-driven codegen wrappers. Each function takes a `PHDocument` of the
 * matching vetra type and dispatches to the generic generate* in
 * `@powerhousedao/codegen`. The state→args translation is lifted verbatim from
 * `packages/vetra/processors/codegen/document-handlers/generators/*-generator.ts`
 * so the agent-driven path and the reactor-driven path produce identical
 * output.
 *
 * Callers are responsible for `await project.save()` after one or more
 * `generate*FromDocument` calls — leaving it out here lets a CLI batch
 * multiple specs into a single save.
 */
import {
  generateApp,
  generateEditor,
  generateProcessor,
  generateSubgraph,
  type GenerateSubgraphOptions,
} from "../index.js";
import {
  PROCESSOR_APPS,
  type ProcessorApp,
  type ProcessorApps,
} from "@powerhousedao/shared/processors";
import { kebabCase } from "change-case";
import type { Project } from "ts-morph";

import type { AppModuleDocument } from "@powerhousedao/vetra/document-models/app-module";
import type {
  DocumentEditorDocument,
  DocumentTypeItem as EditorDocumentTypeItem,
} from "@powerhousedao/vetra/document-models/document-editor";
import type {
  DocumentTypeItem as ProcessorDocumentTypeItem,
  ProcessorModuleDocument,
} from "@powerhousedao/vetra/document-models/processor-module";
import type { SubgraphModuleDocument } from "@powerhousedao/vetra/document-models/subgraph-module";

export async function generateEditorFromDocument(
  doc: DocumentEditorDocument,
  project: Project,
): Promise<void> {
  const state = doc.state.global;
  const documentTypes = state.documentTypes.map(
    (dt: EditorDocumentTypeItem) => dt.documentType,
  );
  await generateEditor(
    {
      editorName: state.name,
      documentTypes,
      editorId: kebabCase(state.name),
    },
    project,
  );
}

export async function generateProcessorFromDocument(
  doc: ProcessorModuleDocument,
  project: Project,
): Promise<void> {
  const state = doc.state.global;
  // Mirror processor-generator.ts:99-103: document model stores `relational`,
  // codegen expects `relationalDb`.
  let processorType: "analytics" | "relationalDb";
  if (state.type === "analytics") {
    processorType = "analytics";
  } else if (state.type === "relational") {
    processorType = "relationalDb";
  } else {
    throw new Error(`Unsupported processor type: "${state.type}"`);
  }

  const documentTypes = state.documentTypes.map(
    (dt: ProcessorDocumentTypeItem) => dt.documentType,
  );
  const processorApps = state.processorApps;
  if (!isProcessorApps(processorApps)) {
    throw new Error(`Unsupported processor apps: ${processorApps.join(", ")}`);
  }
  await generateProcessor(
    {
      processorName: state.name,
      processorType,
      documentTypes,
      processorApps,
    },
    project,
  );
}

export async function generateSubgraphFromDocument(
  doc: SubgraphModuleDocument,
  project: Project,
  options?: GenerateSubgraphOptions,
): Promise<void> {
  await generateSubgraph(doc.state.global.name, project, options);
}

export async function generateAppFromDocument(
  doc: AppModuleDocument,
  project: Project,
): Promise<void> {
  const state = doc.state.global;
  await generateApp(
    {
      appName: state.name,
      appId: kebabCase(state.name),
      allowedDocumentTypes: state.allowedDocumentTypes ?? [],
      isDragAndDropEnabled: state.isDragAndDropEnabled,
    },
    project,
  );
}

function isProcessorApps(input: readonly string[]): input is ProcessorApps {
  if (input.length === 0) return false;
  if (new Set(input).size !== input.length) return false;
  if (!input.every((i) => PROCESSOR_APPS.includes(i as ProcessorApp))) {
    return false;
  }
  return true;
}
