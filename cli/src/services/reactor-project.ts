import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkWorkdir, type EndpointType } from '@powerhousedao/clint';
import type { RunRecord } from '@powerhousedao/host-core';
import { defineService } from '../framework.js';
import { reactorProjectNodeOptions } from '../helpers/node-memory.js';

// Readiness wait for the Preview run; env-overridable for slow runners where
// a cold Vite start exceeds the default. A first start pre-bundles the
// project (measured ~2–4 min on staging), so one attempt gets 300 s.
const READINESS_TIMEOUT_MS =
  Number(process.env.VETRA_REACTOR_READINESS_TIMEOUT_MS) || 300_000;

/** The package's compound the Preview runs (`hosts/preview`), by reference. */
export const PREVIEW_HOST = '@powerhousedao/vetra-cli/preview';
/** Its members the Cli reads. */
export const PREVIEW_SWITCHBOARD_MEMBER = 'preview-switchboard';
export const PREVIEW_CONNECT_MEMBER = 'preview-connect';
/** The Preview drive's declared slug on the switchboard member. */
export const PREVIEW_DRIVE_SLUG = 'preview';

interface SwitchboardMemberOutputs {
  endpoints?: { graphql?: string; mcp?: string };
  drives?: Record<string, { id?: string; url?: string }>;
}

interface ConnectMemberOutputs {
  endpoints?: { connect?: string };
}

/**
 * The Preview's endpoints from its run record, under the names the Studio
 * reads: `vetra-studio` (the Preview Connect), `vetra-switchboard` (its
 * GraphQL), `mcp-server`, and the Preview drive's URL and id. Throws naming
 * what the record lacks.
 */
export function previewEndpoints(
  record: RunRecord,
): Record<string, { url: string; type?: EndpointType }> {
  const members = record.members ?? {};
  const switchboard = members[PREVIEW_SWITCHBOARD_MEMBER]?.outputs as
    | SwitchboardMemberOutputs
    | undefined;
  const connect = members[PREVIEW_CONNECT_MEMBER]?.outputs as
    | ConnectMemberOutputs
    | undefined;
  if (!switchboard || !connect) {
    const names = Object.keys(members);
    throw new Error(
      `the Preview run has no "${PREVIEW_SWITCHBOARD_MEMBER}" and "${PREVIEW_CONNECT_MEMBER}" members (it has ${names.length > 0 ? names.map((n) => `"${n}"`).join(', ') : 'none'})`,
    );
  }
  const studioUrl = connect.endpoints?.connect;
  const graphql = switchboard.endpoints?.graphql;
  const preview = switchboard.drives?.[PREVIEW_DRIVE_SLUG];
  if (!studioUrl) throw new Error(`"${PREVIEW_CONNECT_MEMBER}" reports no endpoints.connect`);
  if (!graphql) throw new Error(`"${PREVIEW_SWITCHBOARD_MEMBER}" reports no endpoints.graphql`);
  if (!preview?.id || !preview.url) {
    throw new Error(`"${PREVIEW_SWITCHBOARD_MEMBER}" serves no "${PREVIEW_DRIVE_SLUG}" drive`);
  }
  const mcp = switchboard.endpoints?.mcp;
  return {
    'vetra-studio': { url: studioUrl, type: 'website' },
    'vetra-switchboard': { url: graphql, type: 'api-graphql' },
    ...(mcp ? { 'mcp-server': { url: mcp, type: 'api-mcp' } } : {}),
    'vetra-preview-drive-url': { url: preview.url, type: 'other' },
    'vetra-preview-drive-id': { url: preview.id, type: 'other' },
  };
}

function isProjectFolder(p: string): boolean {
  return (
    fs.existsSync(path.join(p, 'powerhouse.config.json')) ||
    fs.existsSync(path.join(p, 'powerhouse.config.ts'))
  );
}

/**
 * The Preview run: the package's `preview` host (`ph run
 * @powerhousedao/vetra-cli/preview dev`) in the project. It loads the
 * project's code on a switchboard and a Connect of the Studio's own, with
 * stores under `.ph/vetra/preview/`; the project needs no host for it and its
 * business stores stay closed. Ready once the run record is live; stopped
 * through its stdin.
 */
export const reactorProject = defineService({
  id: 'reactor-project',
  name: 'Preview run',
  description: "The Preview run: the project's code on the Studio's Preview host",
  run: { host: PREVIEW_HOST, verb: 'dev' },
  endpoints: previewEndpoints,
  env: () => ({
    // Heap cap per fork; each child of the run inherits it. See node-memory.ts.
    NODE_OPTIONS: reactorProjectNodeOptions(),
    // The preview reactor is a PUBLIC, no-login reactor. Override the auth env
    // a pod injects (inherited through this process) so it boots OPEN.
    AUTH_ENABLED: 'false',
    DOCUMENT_PERMISSIONS_ENABLED: 'false', // required or reactor-api throws at boot
    DEFAULT_PROTECTION: 'false',
    SKIP_CREDENTIAL_VERIFICATION: 'false',
    ADMINS: '',
  }),
  readiness: { timeout: READINESS_TIMEOUT_MS },
  preflight: [
    checkWorkdir(
      isProjectFolder,
      'Not a Reactor Package project',
      'Run Studio inside a Reactor Package project; ph init creates one',
    ),
    checkWorkdir(
      (cwd) =>
        fs.existsSync(
          path.join(cwd, 'node_modules', '@powerhousedao', 'ph-cli', 'dist', 'cli.mjs'),
        ),
      "The project's ph-cli is not installed",
      'Install the project: pnpm install in its folder',
    ),
    // The Preview's Connect serves the project's editors from its own install.
    checkWorkdir(
      (cwd) => {
        try {
          createRequire(path.join(cwd, 'package.json')).resolve(
            '@powerhousedao/connect/package.json',
          );
          return true;
        } catch {
          return false;
        }
      },
      'The project has no @powerhousedao/connect installed',
      'Add @powerhousedao/connect to the project, as ph init does, and install it',
    ),
  ],
});
