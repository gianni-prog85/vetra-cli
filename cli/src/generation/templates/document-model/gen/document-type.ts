import { ts } from "@tmpl/core";
import type { DocumentModelFileMakerArgs } from "../../../file-builders/index.mjs";

export const documentModelDocumentTypeTemplate = (
  v: DocumentModelFileMakerArgs,
) =>
  ts`
/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
export const ${v.documentTypeVariableName} = "${v.documentModelState.id}";
`.raw;
