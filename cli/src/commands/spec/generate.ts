import type { PHDocument } from "@powerhousedao/shared/document-model";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { assertProjectInstalled, projectRoot } from "../../helpers/project.js";
import {
  runChecks,
  summarizeDiagnostics,
  type GenDiagnostic,
} from "../../helpers/project-checks.js";
import { DOCUMENT_MODEL_TYPE } from "./document-model.js";
import { withProjectCodegenLock } from "../../helpers/project-lock.js";
import {
  generateFromSpec,
  type GenerationKind,
} from "../../generation/run.js";
import { requireSpecDrive } from "../../helpers/embedded-drive.js";
import {
  findSpecInDrive,
  listDriveSpecs,
  specDriveOf,
} from "./drive-specs.js";
import {
  attachCheckResults,
  capReason,
  type ObservedCheck,
} from "../../product/check-results.js";

// documentType → generation kind. The five builder types each have one;
// domain (vetra-app product) spec types have no codegen path.
const GENERATE_SUBCOMMAND: Record<string, GenerationKind> = {
  [DOCUMENT_MODEL_TYPE]: "document-model",
  "powerhouse/document-editor": "editor",
  "powerhouse/app": "app",
  "powerhouse/processor": "processor",
  "powerhouse/subgraph": "subgraph",
};

type Log = { info: (message: string) => void; warn: (message: string) => void };

// `@graphql-tools/load` inlines the failing SDL into the error message;
// these patterns pull the real GraphQLError back out of the wall of types.
const DIAGNOSTIC_PATTERNS = [
  /Failed to parse the GraphQL document\.[^\n]*/,
  /Cannot use [A-Za-z]+ "[^"]+" from another module or realm\.?/,
  /Unknown type[:]? "?[^"\n]+"?/,
  /Unknown directive "?[^"\n]+"?/,
  /Type "[^"]+" not found/,
];

function trimGenerateError(message: string): string {
  for (const pattern of DIAGNOSTIC_PATTERNS) {
    const m = message.match(pattern);
    if (m) return m[0];
  }
  if (/Failed to load schema from/.test(message)) {
    return (
      "GraphQL schema failed to load (check operation/state SDL for " +
      "undeclared types/scalars). Run with debug logging for the full error."
    );
  }
  return message;
}

// Generate the spec's code in the reactor project with the engine in
// `cli/src/generation`, in this process.
async function generateOne(
  doc: PHDocument,
  base: string,
  log: Log | undefined,
): Promise<void> {
  const kind = GENERATE_SUBCOMMAND[doc.header.documentType];
  if (!kind) {
    throw new Error(
      `Unsupported document type for code generation: ${doc.header.documentType}`,
    );
  }
  await generateFromSpec(kind, doc, base, {
    installStdio: "ignore",
    quiet: true,
    log: (message) => log?.info(message),
    warn: (message) => log?.warn(message),
  });
}

/* `reason` is stored and shown to the customer; `detail` is for the agent. */
function generateResult(
  base: string,
  passed: boolean,
  reason: string | null,
  detail?: string,
): ObservedCheck {
  return { kind: "GENERATE", passed, reason: reason ? capReason(reason, { base }) : null, detail };
}

export const specGenerate = defineCommand({
  id: "spec-generate",
  description:
    "Generate source code from one or all specs in the project (document models, editors, apps, processors, subgraphs).",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe(
        "Spec to generate — accepts display name, slug, or id (see spec-list). When omitted, generate code for every spec in the Studio drive.",
      ),
    skipChecks: z
      .boolean()
      .optional()
      .describe(
        "Skip the post-generation typecheck and lint over generated files. Defaults to false.",
      ),
  }),
  execute: async (input, context) => {
    const { workdir, runProcess, log } = context;
    const base = await projectRoot(workdir);
    await assertProjectInstalled(base);
    const drive = specDriveOf(await requireSpecDrive(context));
    // codegen rewrites shared barrels/manifest from the project's view, so
    // concurrent runs clobber each other; serialize per project.
    return withProjectCodegenLock(base, async () => {
      // The documents are read from the drive when the lock is held.
      const targets: PHDocument[] = input.name
        ? [await findSpecInDrive(drive, input.name)]
        : await listDriveSpecs(drive);

      if (targets.length === 0) {
        return { text: "(no specs to generate)" };
      }

      const generated: { name: string; type: string }[] = [];
      const skipped: { name: string; type: string; reason: string }[] = [];
      /* Specs whose codegen ran and failed (not those without codegen). */
      const failed: string[] = [];

      for (const doc of targets) {
        const type = doc.header.documentType;
        if (!GENERATE_SUBCOMMAND[type]) {
          if (input.name) {
            throw new Error(
              `${type} — ${doc.header.name}: (no codegen for ${type})`,
            );
          }
          skipped.push({
            name: doc.header.name,
            type,
            reason: `(no codegen for ${type})`,
          });
          continue;
        }
        try {
          await generateOne(doc, base, log);
          generated.push({ name: doc.header.name, type });
        } catch (err) {
          const reason = trimGenerateError(
            err instanceof Error ? err.message : String(err),
          );
          if (input.name) {
            throw attachCheckResults(
              new Error(`${type} — ${doc.header.name}: ${reason}`),
              [
                generateResult(
                  base,
                  false,
                  `Code couldn't be generated for ${doc.header.name}.`,
                  reason,
                ),
              ],
            );
          }
          skipped.push({ name: doc.header.name, type, reason });
          failed.push(doc.header.name);
        }
      }

      let diagnostics: GenDiagnostic[] = [];
      const checkNotes: string[] = [];
      if (!input.skipChecks && generated.length > 0) {
        const outcome = await runChecks(base, runProcess, { scope: "module" });
        diagnostics = outcome.diagnostics;
        checkNotes.push(...outcome.notes);
      }
      const summary = summarizeDiagnostics(diagnostics);

      if (input.name && summary.errors > 0) {
        const head = diagnostics
          .filter((d) => d.severity === "error")
          .slice(0, 5)
          .map(
            (d) =>
              `[${d.source}] ${d.file}:${d.line}:${d.column} ${d.code} — ${d.message}`,
          )
          .join("\n  ");
        throw attachCheckResults(
          new Error(
            `Generated code has ${summary.errors} error(s) (tsc: ${summary.tsc}, eslint: ${summary.eslint}):\n  ${head}`,
          ),
          [
            generateResult(
              base,
              false,
              `The generated code has ${summary.errors} error(s).`,
              head,
            ),
          ],
        );
      }

      const lines = [
        `Generated ${generated.length} module(s)` +
          (skipped.length > 0 ? `, skipped ${skipped.length}` : "") +
          ".",
      ];
      for (const g of generated) {
        lines.push(`  ✓ ${g.type} — ${g.name}`);
      }
      for (const s of skipped) {
        lines.push(`  ✗ ${s.type} — ${s.name}: ${s.reason}`);
      }
      if (diagnostics.length > 0) {
        lines.push(
          `Generated-file checks: ${summary.errors} error(s), ${summary.warnings} warning(s) (tsc: ${summary.tsc}, eslint: ${summary.eslint}).`,
        );
        for (const d of diagnostics.slice(0, 20)) {
          lines.push(
            `  ${d.severity === "error" ? "✗" : "!"} [${d.source}] ${d.file}:${d.line}:${d.column} ${d.code} — ${d.message}`,
          );
        }
        if (diagnostics.length > 20) {
          lines.push(`  … ${diagnostics.length - 20} more`);
        }
      }
      for (const note of checkNotes) {
        lines.push(`  · ${note}`);
      }

      // GENERATE only when some codegen actually ran (Ruling F1).
      const ranAny = generated.length > 0 || failed.length > 0;
      const problems = [
        ...(failed.length > 0
          ? [`Code couldn't be generated for ${failed.join(", ")}.`]
          : []),
        ...(summary.errors > 0
          ? [`The generated code has ${summary.errors} error(s).`]
          : []),
      ];
      return attachCheckResults(
        { text: lines.join("\n") },
        ranAny
          ? [generateResult(base, problems.length === 0, problems.join(" ") || null)]
          : [],
      );
    });
  },
});
