/**
 * In-process entry of the generation engine: what `ph generate <kind>
 * --document <file>` and `ph generate <kind> --extract` do, as functions.
 */
import type {
  DocumentModelDocument,
  PHDocument,
} from "@powerhousedao/shared/document-model";
import type { AppModuleDocument } from "@powerhousedao/vetra/document-models/app-module";
import type { DocumentEditorDocument } from "@powerhousedao/vetra/document-models/document-editor";
import type { ProcessorModuleDocument } from "@powerhousedao/vetra/document-models/processor-module";
import type { SubgraphModuleDocument } from "@powerhousedao/vetra/document-models/subgraph-module";
import {
  detectFeatures,
  installAddedDependencies,
  loadDocumentModel,
  modelGeneration,
  setGraphqlCodegenSilent,
  syncFeatureDependencies,
} from "./index.js";
import {
  extractAllDocuments,
  extractAppDocuments,
  extractEditorDocuments,
  extractProcessorDocuments,
  extractSubgraphDocuments,
} from "./spec/extract.js";
import {
  generateAppFromDocument,
  generateEditorFromDocument,
  generateProcessorFromDocument,
  generateSubgraphFromDocument,
} from "./spec/generate-from-document.js";
import { extractDocumentModelDocuments } from "./spec/schema-first/extract-document-models.js";
import { getDocument } from "./spec/spec-api.js";
import { saveSpec } from "./spec/specs.js";
import {
  findSubgraphNameConflict,
  lintSubgraphTypes,
} from "./spec/subgraph-type-lint.js";
import { buildTsMorphProject } from "./utils/index.mjs";

export const GENERATION_KINDS = [
  "document-model",
  "editor",
  "app",
  "processor",
  "subgraph",
] as const;

export type GenerationKind = (typeof GENERATION_KINDS)[number];

export type GenerationOptions = {
  /** Leave the dependencies a processor or subgraph adds uninstalled. */
  skipInstall?: boolean;
  /** Where the install's output goes; defaults to this process's. */
  installStdio?: "inherit" | "ignore";
  /** Keep graphql-codegen's task list off this process's output. */
  quiet?: boolean;
  log?: (message: string) => void;
  warn?: (message: string) => void;
};

async function warnSubgraphTypeConflicts(
  projectDir: string,
  warn: (message: string) => void,
): Promise<void> {
  let warnings: string[];
  try {
    warnings = await lintSubgraphTypes(projectDir);
  } catch (error) {
    warn(`⚠ Failed to check subgraph type names: ${String(error)}`);
    return;
  }
  for (const warning of warnings) warn(`⚠ ${warning}`);
}

async function installFeatures(
  projectDir: string,
  { skipInstall, installStdio, log, warn }: GenerationOptions,
): Promise<void> {
  const added = await syncFeatureDependencies(
    detectFeatures(projectDir),
    projectDir,
    log,
  );
  await installAddedDependencies(added, projectDir, {
    skipInstall,
    stdio: installStdio,
    log,
    warn,
  });
}

/** `ph generate <kind> --document <documentPath>` in `projectDir`. */
export async function generateFromSpecFile(
  kind: GenerationKind,
  documentPath: string,
  projectDir: string,
  options: GenerationOptions = {},
): Promise<void> {
  const warn = options.warn ?? console.warn;
  setGraphqlCodegenSilent(options.quiet ?? false);
  const project = buildTsMorphProject(projectDir);
  switch (kind) {
    case "document-model": {
      if (documentPath.endsWith(".phd")) {
        const doc = (await getDocument(documentPath)) as DocumentModelDocument;
        await modelGeneration.generateDocumentModel(doc.state.global, project);
      } else {
        const state = await loadDocumentModel(documentPath);
        await modelGeneration.generateDocumentModel(state, project);
      }
      await project.save();
      await warnSubgraphTypeConflicts(projectDir, warn);
      return;
    }
    case "editor": {
      const doc = (await getDocument(documentPath)) as DocumentEditorDocument;
      await generateEditorFromDocument(doc, project);
      await project.save();
      return;
    }
    case "app": {
      const doc = (await getDocument(documentPath)) as AppModuleDocument;
      await generateAppFromDocument(doc, project);
      await project.save();
      return;
    }
    case "processor": {
      const doc = (await getDocument(documentPath)) as ProcessorModuleDocument;
      await generateProcessorFromDocument(doc, project);
      await project.save();
      await installFeatures(projectDir, options);
      return;
    }
    case "subgraph": {
      const doc = (await getDocument(documentPath)) as SubgraphModuleDocument;
      const conflict = await findSubgraphNameConflict(
        projectDir,
        doc.state.global.name,
      );
      if (conflict) throw new Error(conflict);
      await generateSubgraphFromDocument(doc, project);
      await project.save();
      await warnSubgraphTypeConflicts(projectDir, warn);
      await installFeatures(projectDir, options);
      return;
    }
  }
}

/** `ph generate <kind> --extract` in `projectDir`; resolves to the spec files written. */
export async function extractSpecFiles(
  kind: GenerationKind | "all",
  projectDir: string,
  onWritten?: (path: string) => void,
): Promise<string[]> {
  const project = buildTsMorphProject(projectDir);
  let docs: PHDocument[];
  switch (kind) {
    case "all": {
      const all = extractAllDocuments(project);
      docs = [
        ...all.documentModels,
        ...all.editors,
        ...all.processors,
        ...all.subgraphs,
        ...all.apps,
      ];
      break;
    }
    case "document-model":
      docs = extractDocumentModelDocuments(project);
      break;
    case "editor":
      docs = extractEditorDocuments(project);
      break;
    case "app":
      docs = extractAppDocuments(project);
      break;
    case "processor":
      docs = extractProcessorDocuments(project);
      break;
    case "subgraph":
      docs = extractSubgraphDocuments(project);
      break;
  }
  const written: string[] = [];
  for (const doc of docs) {
    const path = await saveSpec(doc, projectDir);
    written.push(path);
    onWritten?.(path);
  }
  return written;
}
