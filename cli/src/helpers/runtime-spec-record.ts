/**
 * Which documents the runtime spec sync made (`runtime-spec-sync.ts`), kept in
 * `.ph/vetra/runtime-specs.json`: document type → document id. A listed
 * document is the runtime's, so `spec-sync` never writes it to `specs/`.
 */
import fs from "node:fs";
import path from "node:path";
import { studioPath } from "./studio-paths.js";

const RECORD_VERSION = 1;

/** Document type → the id of the document the sync made for it. */
export type RuntimeSpecRecord = Record<string, string>;

export function readRuntimeSpecRecord(workdir: string): RuntimeSpecRecord {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(studioPath(workdir, "runtimeSpecs"), "utf-8"),
    ) as { version?: unknown; documents?: unknown };
    if (parsed.version !== RECORD_VERSION || !parsed.documents) return {};
    const out: RuntimeSpecRecord = {};
    for (const [type, id] of Object.entries(parsed.documents as Record<string, unknown>)) {
      if (typeof id === "string") out[type] = id;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRuntimeSpecRecord(workdir: string, record: RuntimeSpecRecord): void {
  const file = studioPath(workdir, "runtimeSpecs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify({ version: RECORD_VERSION, documents: record }, null, 2)}\n`,
  );
  fs.renameSync(tmp, file);
}

/** The ids of the documents the sync made: not the project's to keep on disk. */
export function runtimeSpecIds(workdir: string): Set<string> {
  return new Set(Object.values(readRuntimeSpecRecord(workdir)));
}
