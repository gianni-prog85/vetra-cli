import type {
  Action,
  DocumentModelGlobalState,
  PHDocument,
  Reducer,
} from "@powerhousedao/shared/document-model";
import { kebabCase } from "change-case";
import { documentModelDocumentModelModule } from "document-model";
import { baseSaveToFile } from "document-model/node";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// The spec models come from @powerhousedao/vetra's exported model modules;
// `documentModel` there is the model's JSON specification.
import {
  actions as appModuleActions,
  appModuleDocumentType,
  createAppModuleDocument,
  documentModel as appModuleSpec,
  reducer as appModuleReducer,
  utils as appModuleUtils,
} from "@powerhousedao/vetra/document-models/app-module";
import {
  actions as documentEditorActions,
  createDocumentEditorDocument,
  documentEditorDocumentType,
  documentModel as documentEditorSpec,
  reducer as documentEditorReducer,
  utils as documentEditorUtils,
} from "@powerhousedao/vetra/document-models/document-editor";
import {
  actions as processorModuleActions,
  createProcessorModuleDocument,
  documentModel as processorModuleSpec,
  processorModuleDocumentType,
  reducer as processorModuleReducer,
  utils as processorModuleUtils,
} from "@powerhousedao/vetra/document-models/processor-module";
import {
  actions as subgraphModuleActions,
  createSubgraphModuleDocument,
  documentModel as subgraphModuleSpec,
  reducer as subgraphModuleReducer,
  subgraphModuleDocumentType,
  utils as subgraphModuleUtils,
} from "@powerhousedao/vetra/document-models/subgraph-module";

export const SPECS_DIRNAME = "specs";

const documentModelDocumentType = "powerhouse/document-model";

type ActionsModule = Record<string, (input?: any) => Action>;

type SpecEntry = {
  documentType: string;
  subdir: string;
  reducer: Reducer<any>;
  utils: { fileExtension: string };
  actions: ActionsModule;
  createDocument: (state?: any) => PHDocument;
  jsonSpec: DocumentModelGlobalState;
};

const SPECS: Record<string, SpecEntry> = {
  [documentModelDocumentType]: {
    documentType: documentModelDocumentType,
    subdir: "document-models",
    reducer: documentModelDocumentModelModule.reducer,
    utils: documentModelDocumentModelModule.utils,
    actions: documentModelDocumentModelModule.actions as ActionsModule,
    createDocument: documentModelDocumentModelModule.utils.createDocument,
    jsonSpec: documentModelDocumentModelModule.documentModel
      .global as DocumentModelGlobalState,
  },
  [documentEditorDocumentType]: {
    documentType: documentEditorDocumentType,
    subdir: "editors",
    reducer: documentEditorReducer as Reducer<any>,
    utils: documentEditorUtils,
    actions: documentEditorActions as unknown as ActionsModule,
    createDocument: createDocumentEditorDocument as (state?: any) => PHDocument,
    jsonSpec: documentEditorSpec as unknown as DocumentModelGlobalState,
  },
  [processorModuleDocumentType]: {
    documentType: processorModuleDocumentType,
    subdir: "processors",
    reducer: processorModuleReducer as Reducer<any>,
    utils: processorModuleUtils,
    actions: processorModuleActions as unknown as ActionsModule,
    createDocument: createProcessorModuleDocument as (
      state?: any,
    ) => PHDocument,
    jsonSpec: processorModuleSpec as unknown as DocumentModelGlobalState,
  },
  [subgraphModuleDocumentType]: {
    documentType: subgraphModuleDocumentType,
    subdir: "subgraphs",
    reducer: subgraphModuleReducer as Reducer<any>,
    utils: subgraphModuleUtils,
    actions: subgraphModuleActions as unknown as ActionsModule,
    createDocument: createSubgraphModuleDocument as (state?: any) => PHDocument,
    jsonSpec: subgraphModuleSpec as unknown as DocumentModelGlobalState,
  },
  [appModuleDocumentType]: {
    documentType: appModuleDocumentType,
    subdir: "apps",
    reducer: appModuleReducer as Reducer<any>,
    utils: appModuleUtils,
    actions: appModuleActions as unknown as ActionsModule,
    createDocument: createAppModuleDocument as (state?: any) => PHDocument,
    jsonSpec: appModuleSpec as unknown as DocumentModelGlobalState,
  },
};

export function getSpecEntry(documentType: string): SpecEntry {
  const entry = SPECS[documentType];
  if (!entry) {
    throw new Error(`No spec handler registered for "${documentType}"`);
  }
  return entry;
}

export function listSpecDocumentTypes(): string[] {
  return Object.keys(SPECS);
}

/** Returns the directory that holds specs for a given document type. */
export function specDir(projectDir: string, documentType: string): string {
  return join(projectDir, SPECS_DIRNAME, getSpecEntry(documentType).subdir);
}

/**
 * Deterministic path for a doc-type + display name.
 * Format: `<projectDir>/<specsDir>/<subdir>/<kebab-name>.<ext>.phd`.
 */
export function specPath(
  projectDir: string,
  documentType: string,
  name: string,
): string {
  const entry = getSpecEntry(documentType);
  const baseName = kebabCase(name);
  const ext = stripLeadingDot(entry.utils.fileExtension);
  return join(specDir(projectDir, documentType), `${baseName}.${ext}.phd`);
}

/* baseSaveToFile expects the extension WITHOUT a leading dot ("phdm"), while the
 * document-model utils export it WITH one (".phdm"). Normalize so we can pass
 * either through. */
export function stripLeadingDot(ext: string): string {
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

/** Saves a document into `<projectDir>/specs/<subdir>/<kebab-name>.<ext>.phd`. */
export async function saveSpec(
  doc: PHDocument,
  projectDir: string,
): Promise<string> {
  const entry = getSpecEntry(doc.header.documentType);
  const dir = specDir(projectDir, doc.header.documentType);
  await mkdir(dir, { recursive: true });
  const name = kebabCase(doc.header.name || "untitled");
  return baseSaveToFile(
    doc,
    dir,
    stripLeadingDot(entry.utils.fileExtension),
    name,
  );
}
