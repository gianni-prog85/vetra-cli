/**
 * The reactor-project service is the Preview run: the package's `preview`
 * host in the project, a host service whose endpoints come from its run
 * record. The record here is the shape that compound writes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreflightContext, ServiceBuildContext } from '@powerhousedao/clint';
import type { Config } from '../../src/framework.js';
import {
  PREVIEW_CONNECT_MEMBER,
  PREVIEW_DRIVE_SLUG,
  PREVIEW_SWITCHBOARD_MEMBER,
  previewEndpoints,
  reactorProject,
} from '../../src/services/reactor-project.js';
import { defaultConfig } from '../spec/_fixtures.js';
import { recordFixture } from './run-record.js';

function buildCtx(): ServiceBuildContext<Config> {
  return { config: defaultConfig() };
}

describe('reactor-project as a host service', () => {
  it('runs the package\'s preview host at dev, readiness from its run record', () => {
    expect(reactorProject.run).toEqual({ host: '@powerhousedao/vetra-cli/preview', verb: 'dev' });
    expect(reactorProject.command).toBeUndefined();
    expect(reactorProject.readiness?.patterns).toBeUndefined();
  });

  it('keeps the preview reactor open and caps the heap; ports are host data', () => {
    const { env } = reactorProject;
    if (typeof env !== 'function') throw new Error('expected env function');
    const e = env(buildCtx());
    expect(e.NODE_OPTIONS).toMatch(/--max-old-space-size=/);
    expect(e.AUTH_ENABLED).toBe('false');
    expect(e.DOCUMENT_PERMISSIONS_ENABLED).toBe('false');
    expect(e.DEFAULT_PROTECTION).toBe('false');
    expect(e.SKIP_CREDENTIAL_VERIFICATION).toBe('false');
    expect(e.ADMINS).toBe('');
    expect(e.PORT).toBeUndefined();
  });
});

describe('the package\'s preview hosts', () => {
  const hostOf = async (name: string) =>
    (await import(`../../../hosts/${name}/host.js`)).default as {
      name: string;
      runner: { module: string; plugins?: unknown[] };
      children?: Record<string, { host: string }>;
      config?: { switchboard?: Record<string, unknown> };
      reactor?: {
        backends: Record<string, { kind: string; storage?: { dataDir?: string }; readModel?: { url?: string } }>;
        drives: { slug: string }[];
      };
    };

  it('the compound names the members the service reads', async () => {
    const preview = await hostOf('preview');
    expect(preview.name).toBe('preview');
    expect(Object.keys(preview.children ?? {})).toEqual([
      PREVIEW_SWITCHBOARD_MEMBER,
      PREVIEW_CONNECT_MEMBER,
    ]);
    for (const [member, child] of Object.entries(preview.children ?? {})) {
      expect((await hostOf(child.host)).name).toBe(member);
    }
  });

  it('the switchboard keeps its stores under the Studio folder and loads the project', async () => {
    const switchboard = await hostOf(PREVIEW_SWITCHBOARD_MEMBER);
    const text = JSON.stringify(switchboard);
    // Every path it names is under <project>/.ph/vetra/preview, or the package's.
    const paths = [...text.matchAll(/"(\$\{(?:userData|package)\}[^"]*)"/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThanOrEqual(6);
    for (const p of paths) {
      expect(p).toMatch(/^\$\{userData\}\/\.ph\/vetra\/preview\/|^\$\{package\}\//);
    }
    expect(switchboard.reactor?.backends.main?.storage?.dataDir).toBe(
      '${userData}/.ph/vetra/preview/reactor-storage',
    );
    // The project (the working directory) is the local package.
    expect(text).not.toContain('disableLocal');
  });

  it('nothing in the Preview rewrites the project: no codegen drive, the inspector keeps codegen off', async () => {
    const switchboard = await hostOf(PREVIEW_SWITCHBOARD_MEMBER);
    const slugs = (switchboard.reactor?.drives ?? []).map((d) => d.slug);
    expect(slugs).toEqual([PREVIEW_DRIVE_SLUG]);
    // @powerhousedao/vetra's codegen processor attaches to `vetra`/`vetra-*`.
    for (const slug of slugs) expect(slug).not.toMatch(/^vetra(-|$)/);
    const inspector = (switchboard.runner.plugins ?? []).find(
      (p): p is { module: string; config: Record<string, unknown> } =>
        typeof p === 'object' && p !== null && (p as { module?: string }).module === '@powerhousedao/switchboard/plugins/inspector',
    );
    expect(inspector?.config).toEqual({
      reportFile: '${userData}/.ph/vetra/preview/inspector.json',
    });
    expect(JSON.stringify(switchboard.runner.plugins)).not.toContain('workflows');
  });

  it('Connect is a remote client of the Preview switchboard\'s drive', async () => {
    const connect = await hostOf(PREVIEW_CONNECT_MEMBER);
    expect(connect.reactor?.drives.map((d) => d.slug)).toEqual([PREVIEW_DRIVE_SLUG]);
    expect(JSON.stringify(connect)).toContain(
      JSON.stringify({ $output: { host: PREVIEW_SWITCHBOARD_MEMBER, path: ['drives', PREVIEW_DRIVE_SLUG, 'url'] } }),
    );
    expect(Object.values(connect.reactor?.backends ?? {}).map((b) => b.kind)).toEqual(['remote']);
  });
});

describe('previewEndpoints', () => {
  it('maps the members\' outputs to the names the Studio reads', () => {
    expect(previewEndpoints(recordFixture())).toEqual({
      'vetra-studio': { url: 'http://localhost:3001/', type: 'website' },
      'vetra-switchboard': { url: 'http://localhost:4001/graphql', type: 'api-graphql' },
      'mcp-server': { url: 'http://localhost:4001/mcp', type: 'api-mcp' },
      'vetra-preview-drive-url': {
        url: 'http://localhost:4001/d/vetra-preview-1a2b3c4d',
        type: 'other',
      },
      'vetra-preview-drive-id': { url: 'vetra-preview-1a2b3c4d', type: 'other' },
    });
  });

  it('names the members it expects when the run has others', () => {
    const record = recordFixture();
    record.members = { switchboard: record.members![PREVIEW_SWITCHBOARD_MEMBER]! };
    expect(() => previewEndpoints(record)).toThrow(
      /no "preview-switchboard" and "preview-connect" members \(it has "switchboard"\)/,
    );
  });

  it('refuses a switchboard member that serves no preview drive', () => {
    const record = recordFixture();
    const outputs = record.members![PREVIEW_SWITCHBOARD_MEMBER]!.outputs as {
      drives: Record<string, unknown>;
    };
    delete outputs.drives[PREVIEW_DRIVE_SLUG];
    expect(() => previewEndpoints(record)).toThrow(/serves no "preview" drive/);
  });

  it('leaves out an MCP endpoint the switchboard does not mount', () => {
    const record = recordFixture();
    const outputs = record.members![PREVIEW_SWITCHBOARD_MEMBER]!.outputs as {
      endpoints: { mcp?: string };
    };
    delete outputs.endpoints.mcp;
    expect(previewEndpoints(record)['mcp-server']).toBeUndefined();
  });
});

describe('reactor-project preflight', () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(path.join(tmpdir(), 'reactor-project-'));
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  async function failures(): Promise<string[]> {
    const ctx = { cwd: project, config: defaultConfig() } as PreflightContext<Config>;
    const messages: string[] = [];
    for (const check of reactorProject.preflight ?? []) {
      const result = await check(ctx);
      if (!result.ok) messages.push(result.message);
    }
    return messages;
  }

  it('needs a project with its ph-cli and Connect installed, and no host of its own', async () => {
    const noCli = expect.stringContaining('ph-cli is not installed');
    const noConnect = expect.stringContaining('no @powerhousedao/connect installed');
    expect(await failures()).toEqual([
      expect.stringContaining('Not a Reactor Package project'),
      noCli,
      noConnect,
    ]);
    writeFileSync(path.join(project, 'powerhouse.config.json'), '{}');
    writeFileSync(path.join(project, 'package.json'), '{}');
    expect(await failures()).toEqual([noCli, noConnect]);

    const scope = path.join(project, 'node_modules', '@powerhousedao');
    const cli = path.join(scope, 'ph-cli', 'dist');
    mkdirSync(cli, { recursive: true });
    writeFileSync(path.join(cli, 'cli.mjs'), '');
    expect(await failures()).toEqual([noConnect]);

    mkdirSync(path.join(scope, 'connect'), { recursive: true });
    writeFileSync(path.join(scope, 'connect', 'package.json'), '{"name":"@powerhousedao/connect"}');
    // No hosts/ folder in the project.
    expect(await failures()).toEqual([]);
  });
});
