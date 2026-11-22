/**
 * The reactor-project service is the project's own `ph run vetra dev`: a host
 * service whose endpoints come from the project's `.ph/run/vetra.json`. The
 * record here is the shape a 6.4 scaffold's vetra compound writes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreflightContext, ServiceBuildContext } from '@powerhousedao/clint';
import type { Config } from '../../src/framework.js';
import { previewEndpoints, reactorProject } from '../../src/services/reactor-project.js';
import { defaultConfig } from '../spec/_fixtures.js';
import { recordFixture } from './run-record.js';

function buildCtx(): ServiceBuildContext<Config> {
  return { config: defaultConfig() };
}

describe('reactor-project as a host service', () => {
  it('runs the project\'s vetra host at dev, readiness from its run record', () => {
    expect(reactorProject.run).toEqual({ host: 'vetra', verb: 'dev' });
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

describe('previewEndpoints', () => {
  it('maps the members\' outputs to the names the Studio reads', () => {
    expect(previewEndpoints(recordFixture())).toEqual({
      'vetra-studio': { url: 'http://localhost:3001/', type: 'website' },
      'vetra-switchboard': { url: 'http://localhost:4001/graphql', type: 'api-graphql' },
      'mcp-server': { url: 'http://localhost:4001/mcp', type: 'api-mcp' },
      'vetra-drive-url': { url: 'http://localhost:4001/d/vetra-1a2b3c4d', type: 'other' },
      'vetra-preview-drive-url': {
        url: 'http://localhost:4001/d/vetra-preview-1a2b3c4d',
        type: 'other',
      },
      'vetra-preview-drive-id': { url: 'vetra-preview-1a2b3c4d', type: 'other' },
    });
  });

  it('names the members it expects when the host has others', () => {
    const record = recordFixture();
    record.members = { switchboard: record.members!['vetra-switchboard']! };
    expect(() => previewEndpoints(record)).toThrow(
      /no "vetra-switchboard" and "vetra-studio" members \(it has "switchboard"\)/,
    );
  });

  it('refuses a switchboard member that serves no preview drive', () => {
    const record = recordFixture();
    const outputs = record.members!['vetra-switchboard']!.outputs as {
      drives: Record<string, unknown>;
    };
    delete outputs.drives['vetra-preview'];
    expect(() => previewEndpoints(record)).toThrow(/serves no "vetra-preview" drive/);
  });

  it('leaves out an MCP endpoint the switchboard does not mount', () => {
    const record = recordFixture();
    const outputs = record.members!['vetra-switchboard']!.outputs as {
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
    const ctx = { cwd: project } as PreflightContext<Config>;
    const messages: string[] = [];
    for (const check of reactorProject.preflight ?? []) {
      const result = await check(ctx);
      if (!result.ok) messages.push(result.message);
    }
    return messages;
  }

  it('needs a project with a vetra host and its ph-cli installed', async () => {
    writeFileSync(path.join(project, 'powerhouse.config.json'), '{}');
    expect(await failures()).toEqual([
      expect.stringContaining('no vetra host (hosts/vetra/host.js)'),
      expect.stringContaining("ph-cli is not installed"),
    ]);

    mkdirSync(path.join(project, 'hosts', 'vetra'), { recursive: true });
    writeFileSync(path.join(project, 'hosts', 'vetra', 'host.js'), 'export default {};');
    const cli = path.join(project, 'node_modules', '@powerhousedao', 'ph-cli', 'dist');
    mkdirSync(cli, { recursive: true });
    writeFileSync(path.join(cli, 'cli.mjs'), '');
    expect(await failures()).toEqual([]);
  });
});
