/**
 * What the Preview run has loaded, as its inspector reports it.
 *
 * The Preview switchboard's inspector plugin
 * (`@powerhousedao/switchboard/plugins/inspector`, see
 * `hosts/preview-switchboard`) writes the loaded document model modules to
 * `.ph/vetra/preview/inspector.json` when its reactor is ready and again on
 * every package reload, and removes the file when it stops. The Cli reads the
 * file; it is trusted only while the Preview run is up: its service instance
 * is ready, or its run record is live (a hard kill leaves the file behind).
 */
import fs from "node:fs";
import type { ServiceInstanceStatus, ServiceManager } from "@powerhousedao/clint";
import { runningInstance } from "@powerhousedao/host-core/instance";
import { z } from "zod";
import { PREVIEW_HOST } from "../services/reactor-project.js";
import { studioPath } from "./studio-paths.js";

/** The report version this Cli reads. */
export const INSPECTOR_REPORT_VERSION = 1;

const modelSchema = z.object({
  documentType: z.string(),
  name: z.string(),
  version: z.number().optional(),
  /** The module's `documentModel` global state: every specification. */
  documentModel: z.record(z.string(), z.unknown()),
});

const reportSchema = z.object({
  version: z.literal(INSPECTOR_REPORT_VERSION),
  sequence: z.number(),
  writtenAt: z.string(),
  pid: z.number(),
  packages: z.array(
    z.object({
      name: z.string(),
      local: z.boolean(),
      models: z.array(modelSchema),
    }),
  ),
});

export type InspectorReport = z.infer<typeof reportSchema>;
export type InspectorModel = z.infer<typeof modelSchema>;

/** One document type the Preview has loaded, over all its versions. */
export interface PreviewModelType {
  documentType: string;
  name: string;
  /** The package that supplies it, as the package manager keys it. */
  package: string;
  /** Supplied by the project itself (the Preview's working directory). */
  local: boolean;
  /** The loaded versions, ascending; empty for a model that is not versioned. */
  versions: number[];
  /** One `documentModel` global state per loaded module, in `versions` order. */
  documentModels?: Record<string, unknown>[];
}

export type PreviewModels =
  /** No Preview run for the project. */
  | { kind: "not-running" }
  /** Starting, or ready with no report yet. */
  | { kind: "starting" }
  | {
      kind: "ready";
      /** Counts up with every report of this run: 1 at ready, +1 per reload. */
      sequence: number;
      writtenAt: string;
      /** The project's own types, the count C2 reports. */
      projectTypes: number;
      types: PreviewModelType[];
    };

/** The report in `workdir`, or undefined: none, unreadable, or another version. */
export function readInspectorReport(workdir: string): InspectorReport | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(studioPath(workdir, "previewInspector"), "utf-8");
  } catch {
    return undefined;
  }
  try {
    const parsed = reportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The report's modules grouped per document type, sorted by type. */
export function modelTypesOf(
  report: InspectorReport,
  options: { full?: boolean } = {},
): PreviewModelType[] {
  const byType = new Map<string, { type: PreviewModelType; models: InspectorModel[] }>();
  // A type two packages supply: the project's own wins, else the first.
  const packages = [...report.packages].sort((a, b) => Number(b.local) - Number(a.local));
  for (const pkg of packages) {
    for (const model of pkg.models) {
      const seen = byType.get(model.documentType);
      if (seen) {
        if (seen.type.package === pkg.name) seen.models.push(model);
        continue;
      }
      byType.set(model.documentType, {
        type: {
          documentType: model.documentType,
          name: model.name,
          package: pkg.name,
          local: pkg.local,
          versions: [],
        },
        models: [model],
      });
    }
  }
  return [...byType.values()]
    .map(({ type, models }) => {
      const sorted = [...models].sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
      const latest = sorted[sorted.length - 1]!;
      return {
        ...type,
        name: latest.name,
        versions: sorted.flatMap((m) => (m.version === undefined ? [] : [m.version])),
        ...(options.full ? { documentModels: sorted.map((m) => m.documentModel) } : {}),
      };
    })
    .sort((a, b) => a.documentType.localeCompare(b.documentType));
}

/** The Preview run's instance for `projectPath`, live ones first. */
function previewInstance(
  services: Pick<ServiceManager, "list">,
  projectPath: string,
): ServiceInstanceStatus | undefined {
  const instances = services.list("reactor-project").filter((i) => i.workdir === projectPath);
  return (
    instances.find((i) => i.status === "ready") ??
    instances.find((i) => i.status === "starting")
  );
}

/** The Preview run of `projectPath` is live, by its run record. */
function previewRuns(projectPath: string): boolean {
  try {
    return runningInstance(projectPath, PREVIEW_HOST) !== undefined;
  } catch {
    return false;
  }
}

/**
 * What the Preview run of `projectPath` has loaded. The Cli that holds the
 * run knows its state; any other process (a one-shot command beside the
 * Studio) reads the run's record, which is live once the run is ready.
 */
export function previewModels(
  services: Pick<ServiceManager, "list"> | undefined,
  projectPath: string,
  options: { full?: boolean } = {},
): PreviewModels {
  const instance = services && previewInstance(services, projectPath);
  if (instance?.status !== "ready" && !previewRuns(projectPath)) {
    return instance ? { kind: "starting" } : { kind: "not-running" };
  }
  const report = readInspectorReport(projectPath);
  if (!report) return { kind: "starting" };
  const types = modelTypesOf(report, options);
  return {
    kind: "ready",
    sequence: report.sequence,
    writtenAt: report.writtenAt,
    projectTypes: types.filter((t) => t.local).length,
    types,
  };
}

/** `v1, v2`, or nothing for a model that is not versioned. */
function versionsText(versions: readonly number[]): string {
  return versions.map((v) => `v${v}`).join(", ");
}

/** The models as lines of text: the project's own first. */
export function formatPreviewModels(models: PreviewModels): string {
  if (models.kind === "not-running") {
    return "The Preview run is not running: start it with `reactor-project-start`.";
  }
  if (models.kind === "starting") {
    return "The Preview run is starting: its inspector has not reported yet. Retry shortly.";
  }
  const line = (t: PreviewModelType) => {
    const versions = versionsText(t.versions);
    return `  ${t.documentType}  ${t.name}${versions ? `  (${versions})` : ""}`;
  };
  const own = models.types.filter((t) => t.local);
  const others = models.types.filter((t) => !t.local);
  const lines = [
    `The Preview run has loaded ${own.length} model type${own.length === 1 ? "" : "s"} of the project (report ${models.sequence}, ${models.writtenAt}):`,
    ...own.map(line),
  ];
  if (others.length > 0) {
    lines.push(`And ${others.length} from other packages:`);
    for (const t of others) lines.push(`${line(t)}  [${t.package}]`);
  }
  return lines.join("\n");
}
