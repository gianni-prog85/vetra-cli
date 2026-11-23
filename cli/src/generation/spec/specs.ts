import type {
  Action,
  DocumentModelGlobalState,
  PHDocument,
  Reducer,
} from "@powerhousedao/shared/document-model";
import { documentModelDocumentModelModule } from "document-model";

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

const documentModelDocumentType = "powerhouse/document-model";

type ActionsModule = Record<string, (input?: any) => Action>;

type SpecEntry = {
  documentType: string;
  reducer: Reducer<any>;
  utils: { fileExtension: string };
  actions: ActionsModule;
  createDocument: (state?: any) => PHDocument;
  jsonSpec: DocumentModelGlobalState;
};

const SPECS: Record<string, SpecEntry> = {
  [documentModelDocumentType]: {
    documentType: documentModelDocumentType,
    reducer: documentModelDocumentModelModule.reducer,
    utils: documentModelDocumentModelModule.utils,
    actions: documentModelDocumentModelModule.actions as ActionsModule,
    createDocument: documentModelDocumentModelModule.utils.createDocument,
    jsonSpec: documentModelDocumentModelModule.documentModel
      .global as DocumentModelGlobalState,
  },
  [documentEditorDocumentType]: {
    documentType: documentEditorDocumentType,
    reducer: documentEditorReducer as Reducer<any>,
    utils: documentEditorUtils,
    actions: documentEditorActions as unknown as ActionsModule,
    createDocument: createDocumentEditorDocument as (state?: any) => PHDocument,
    jsonSpec: documentEditorSpec as unknown as DocumentModelGlobalState,
  },
  [processorModuleDocumentType]: {
    documentType: processorModuleDocumentType,
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
    reducer: subgraphModuleReducer as Reducer<any>,
    utils: subgraphModuleUtils,
    actions: subgraphModuleActions as unknown as ActionsModule,
    createDocument: createSubgraphModuleDocument as (state?: any) => PHDocument,
    jsonSpec: subgraphModuleSpec as unknown as DocumentModelGlobalState,
  },
  [appModuleDocumentType]: {
    documentType: appModuleDocumentType,
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
