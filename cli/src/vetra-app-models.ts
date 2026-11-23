// The product spec models: the package's own and @powerhousedao/vetra's
// ideate and build documents, each via a narrow `document-models` entry, so
// the editor graph (katex/mermaid) stays out of the bundle.
import { StudioProductV1 } from 'document-models';
import {
  AudienceSheetV1,
  BrandSheetV1,
  FeatureV1,
  ProblemSheetV1,
  WorkBreakdownStructureV1,
} from '@powerhousedao/vetra/document-models';

// Annotated: the modules' own types have no importable name for a declaration.
export const documentModels: readonly unknown[] = [
  AudienceSheetV1,
  BrandSheetV1,
  FeatureV1,
  ProblemSheetV1,
  StudioProductV1,
  WorkBreakdownStructureV1,
];
