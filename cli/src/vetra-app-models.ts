// The package's document models via the narrow `document-models` entry, so
// the editor graph (katex/mermaid) stays out of the bundle.
import {
  AudienceSheetV1,
  BrandSheetV1,
  FeatureV1,
  ProblemSheetV1,
  StudioProductV1,
  WorkBreakdownStructureV1,
} from 'document-models';

export const documentModels = [
  AudienceSheetV1,
  BrandSheetV1,
  FeatureV1,
  ProblemSheetV1,
  StudioProductV1,
  WorkBreakdownStructureV1,
];
