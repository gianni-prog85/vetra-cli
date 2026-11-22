/**
 * The specifications of the project the Studio runs in (pure, unit-testable).
 *
 * The Studio runs inside one project, and every spec file node sits at the
 * Home drive's root: the SPECIFY navigator lists one set of specifications.
 * Pure (no React) so it can be tested without a renderer — mirroring
 * `auto-nav.ts`.
 */
import type { FileNode } from "@powerhousedao/shared/document-drive";

export const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";

/** documentType → display label for builder spec types recognised by the SPECIFY section. */
export const SPECIFY_TYPES: ReadonlyMap<string, string> = new Map([
  [DOCUMENT_MODEL_TYPE, "Document model"],
  ["powerhouse/document-editor", "Document editor"],
  ["powerhouse/processor", "Processor"],
  ["powerhouse/subgraph", "Subgraph"],
  ["powerhouse/app", "App"],
]);

export type ProjectDocument = {
  id: string;
  name: string;
  documentType: string;
};

/** The project the Studio runs in, as the Deploy view shows it. */
export type Project = {
  id: string;
  name: string;
  documents: ProjectDocument[];
};

/** The one project's id (the Studio runs in one project). */
export const PROJECT_ID = "project";
/** The project's name while its package name isn't known. */
export const PROJECT_FALLBACK_NAME = "This project";

/** The drive's spec documents, wherever they are filed, by name (then id). */
export function specDocuments(files: readonly FileNode[]): ProjectDocument[] {
  return files
    .filter((file) => SPECIFY_TYPES.has(file.documentType))
    .map((file) => ({
      id: file.id,
      name: file.name,
      documentType: file.documentType,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
