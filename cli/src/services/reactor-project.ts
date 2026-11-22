import fs from 'node:fs';
import path from 'node:path';
import { checkWorkdir, type EndpointType } from '@powerhousedao/clint';
import type { RunRecord } from '@powerhousedao/host-core';
import { defineService } from '../framework.js';
import { reactorProjectNodeOptions } from '../helpers/node-memory.js';

// Readiness wait for the project's `ph run vetra dev`; env-overridable for
// slow runners where a cold Vite start exceeds the default. A fresh Studio's
// first start pre-bundles the project (measured ~2–4 min on staging), so one
// attempt gets 300 s.
const READINESS_TIMEOUT_MS =
  Number(process.env.VETRA_REACTOR_READINESS_TIMEOUT_MS) || 300_000;

/** The project's compound the preview runs, and its members the Cli reads. */
export const PREVIEW_HOST = 'vetra';
export const PREVIEW_SWITCHBOARD_MEMBER = 'vetra-switchboard';
export const PREVIEW_CONNECT_MEMBER = 'vetra-studio';
/** The preview drive's declared slug on the switchboard member. */
export const PREVIEW_DRIVE_SLUG = 'vetra-preview';

interface SwitchboardMemberOutputs {
  endpoints?: { graphql?: string; mcp?: string };
  drives?: Record<string, { id?: string; url?: string }>;
}

interface ConnectMemberOutputs {
  endpoints?: { connect?: string };
}

/**
 * The preview's endpoints from the project's `.ph/run/vetra.json`, under the
 * names the Studio reads: `vetra-studio` (the project's Connect),
 * `vetra-switchboard` (its GraphQL), `mcp-server`, the Vetra and preview
 * drives' URLs and the preview drive's id. Throws naming what the record
 * lacks: a project whose vetra host names its members otherwise cannot
 * preview yet.
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
      `the project's ${PREVIEW_HOST} host has no "${PREVIEW_SWITCHBOARD_MEMBER}" and "${PREVIEW_CONNECT_MEMBER}" members (it has ${names.length > 0 ? names.map((n) => `"${n}"`).join(', ') : 'none'})`,
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
  const vetraDrive = switchboard.drives?.vetra?.url;
  return {
    'vetra-studio': { url: studioUrl, type: 'website' },
    'vetra-switchboard': { url: graphql, type: 'api-graphql' },
    ...(mcp ? { 'mcp-server': { url: mcp, type: 'api-mcp' } } : {}),
    ...(vetraDrive ? { 'vetra-drive-url': { url: vetraDrive, type: 'other' } } : {}),
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

/** The refusal while the project run is off (`projectRun`, the default). */
export const PROJECT_RUN_OFF = 'The project run is off';
export const PROJECT_RUN_OFF_HINT =
  "Studio starts no stack of the project's own unless asked: set projectRun: true (env VETRA_PROJECT_RUN=1) for a scaffolded project. The package's Preview run (C2) replaces it";

/**
 * The builder's project run: `ph run vetra dev` in the project, its stores
 * and run record the project's own (`.ph/`). Ready once `.ph/run/vetra.json`
 * is live; stopped through its stdin. Opt-in (`projectRun`): the run opens the
 * project's business stores, so no start path (agent, BUILD pane, restart)
 * gets past the first preflight while it is off.
 */
export const reactorProject = defineService({
  id: 'reactor-project',
  name: 'Reactor Project',
  description: "The project's Vetra host (ph run vetra dev) for previews",
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
    ({ config }) =>
      config.projectRun
        ? { ok: true }
        : { ok: false, message: PROJECT_RUN_OFF, hint: PROJECT_RUN_OFF_HINT },
    checkWorkdir(
      isProjectFolder,
      'Not a Reactor Package project',
      'Run reactor-project-start --workdir <project>, or create one with /reactor-project-init',
    ),
    checkWorkdir(
      (cwd) => fs.existsSync(path.join(cwd, 'hosts', PREVIEW_HOST, 'host.js')),
      `The project has no ${PREVIEW_HOST} host (hosts/${PREVIEW_HOST}/host.js)`,
      'Projects scaffolded by ph init on Powerhouse 6.4 have it; an older project cannot preview yet',
    ),
    checkWorkdir(
      (cwd) =>
        fs.existsSync(
          path.join(cwd, 'node_modules', '@powerhousedao', 'ph-cli', 'dist', 'cli.mjs'),
        ),
      "The project's ph-cli is not installed",
      'Install the project: pnpm install in its folder',
    ),
  ],
  projectScanner: { isProjectFolder },
});
