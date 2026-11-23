/** Ids, descriptions and input schemas of the reactor-project commands (see ../spec/meta.ts). */
import { z } from 'zod';

export const reactorProjectBuildMeta = {
  id: 'reactor-project-build',
  description: 'Build the Reactor package project (runs ph build in the workdir)',
  inputSchema: z.object({
    log: z
      .boolean()
      .optional()
      .describe('Whether to log build output to the console. Defaults to false.'),
  }),
};

export const reactorProjectCheckMeta = {
  id: "reactor-project-check",
  description:
    "Run TypeScript and ESLint over the Reactor project (the workdir) and report any diagnostics. Useful after hand-editing generated code or to verify the project compiles cleanly.",
  inputSchema: z.object({
    scope: z
      .enum(["all", "module"])
      .optional()
      .describe(
        "Which files to report on. 'all' (default) covers the whole project; 'module' covers the spec-authored trees (document-models/editors/apps/processors/subgraphs).",
      ),
    skipLint: z
      .boolean()
      .optional()
      .describe("Skip the eslint pass. Defaults to false."),
    skipTypecheck: z
      .boolean()
      .optional()
      .describe("Skip the tsc pass. Defaults to false."),
    tests: z
      .boolean()
      .optional()
      .describe(
        "Also run the project's reducer tests and the preview smoke check (package builds; every editor/app module loads in the running preview; the example documents in seed/*.json fit the document models). Needed before finishing the Tests step. Defaults to false.",
      ),
  }),
};

export const reactorProjectPublishMeta = {
  id: 'reactor-project-publish',
  description: `Build and publish a Reactor Package to the Powerhouse registry.

This command:
1. Optionally updates the version in package.json
2. Runs \`reactor-project-build\` — uses tsdown to produce Node.js and browser bundles so the package can be loaded in both Connect (browser) and Switchboard (Node.js) instances
3. Resolves the registry URL (--registry flag > PH_REGISTRY_URL env > powerhouse.config.json > default)
4. Mints a short-lived registry token from the agent's Renown identity
5. Runs npm publish with that token

Prerequisites: the agent must be authorized with the user's Renown identity
(the studio "Authorize agent" button, or \`ph login\` from the CLI). No npm
login is required.`,
  inputSchema: z.object({
    version: z
      .string()
      .optional()
      .describe(
        "Package version to set before publishing (e.g. '1.2.3'). Updates package.json in place.",
      ),
    registry: z.url().optional().describe('Registry URL to publish to.'),
    tag: z
      .string()
      .optional()
      .describe('npm dist-tag to publish under (e.g. "dev", "next").'),
    skipBuild: z.boolean().optional().describe('Skip the build step before publishing.'),
    dryRun: z.boolean().optional().describe('Perform a dry run without actually publishing.'),
    log: z
      .boolean()
      .optional()
      .describe('Whether to log output to the console. Only enable for debugging purposes.'),
  }),
};

export const reactorProjectPublishStatusMeta = {
  id: 'reactor-project-publish-status',
  description: `Check whether a Reactor package's name@version is already published to the registry.

Reports published / not-published / unknown for the version, plus the latest
published version, so the deploy flow can decide whether to reuse the last
publish or publish new changes. Reads the registry with the agent's Renown
token (the same identity \`reactor-project-publish\` uses); if the registry
requires auth and the agent isn't authorized, the result is reported as
"unknown" rather than guessed.`,
  inputSchema: z.object({
    version: z
      .string()
      .optional()
      .describe(
        "Version to check. Defaults to the project's package.json version. Pass a specific version to check whether that exact release is published.",
      ),
    registry: z
      .url()
      .optional()
      .describe(
        'Registry URL to query (flag > PH_REGISTRY_URL env > config.registryUrl > default). Pass the environment\'s package registry so the check matches where the env installs from.',
      ),
  }),
};

export const previewModelsMeta = {
  id: "preview-models",
  description:
    "List the document model types (and versions) the Preview run has loaded from the project, as its inspector reports them",
  inputSchema: z.object({
    full: z
      .boolean()
      .optional()
      .describe("Include each version's full document model state in the data. Defaults to false."),
  }),
};
