import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { LifecycleInitContext, ServiceBuildContext } from '@powerhousedao/clint';
import type { Config } from '../../src/framework.js';
import {
  deployBasePath,
  proxyBasePathHook,
  reactorProject,
} from '../../src/services/reactor-project.js';
import { defaultConfig } from '../spec/_fixtures.js';

/** A ServiceBuildContext as the service manager builds it (no proxy mount). */
function buildCtx(params?: Record<string, unknown>): ServiceBuildContext<Config> {
  return { ...(params ? { params } : {}), config: defaultConfig(), proxy: { basePath: '' } };
}

// ── deployBasePath ─────────────────────────────────────────────────

describe('deployBasePath', () => {
  it('returns "" when unset', () => {
    expect(deployBasePath(undefined)).toBe('');
    expect(deployBasePath('')).toBe('');
    expect(deployBasePath('   ')).toBe('');
  });

  it('returns "" for a root-path URL', () => {
    expect(deployBasePath('https://studio.example.com')).toBe('');
    expect(deployBasePath('https://studio.example.com/')).toBe('');
  });

  it('returns the pathname without trailing slashes', () => {
    expect(deployBasePath('https://example.com/myagent')).toBe('/myagent');
    expect(deployBasePath('https://example.com/myagent/')).toBe('/myagent');
    expect(deployBasePath('https://example.com/a/b///')).toBe('/a/b');
  });

  it('returns "" for an invalid URL', () => {
    expect(deployBasePath('not a url')).toBe('');
  });
});

// ── proxyBasePathHook → command --base ─────────────────────────────

function initHook(proxyPublicUrl: string | undefined): void {
  void proxyBasePathHook().onInit({
    config: { proxyPublicUrl },
  } as unknown as LifecycleInitContext);
}

function baseFlag(): string {
  const { command } = reactorProject;
  if (typeof command !== 'function') throw new Error('expected command function');
  const match = /--base (\S+)/.exec(command(buildCtx()));
  if (!match?.[1]) throw new Error('--base flag not found in command');
  return match[1];
}

describe('reactor-project --base', () => {
  it('uses the proxy prefix alone when no publicUrl is configured', () => {
    initHook(undefined);
    expect(baseFlag()).toBe('/reactor-project/vetra-studio/');
  });

  it('prefixes the resolved publicUrl pathname', () => {
    initHook('https://example.com/myagent/');
    expect(baseFlag()).toBe('/myagent/reactor-project/vetra-studio/');
    initHook(undefined);
  });
});

describe('reactor-project --renown-namespace', () => {
  // The Studio Connect and the preview Connect are same-origin apps. A shared
  // Renown namespace means one localStorage session for both, but the preview
  // Connect verifies it against the project's Renown (www.renown.id), not the
  // Studio's (RENOWN_URL / cloud Renown). Where those differ, the preview's
  // boot-time revalidation finds no credential and logs out the shared session:
  // the Studio's sync goes anonymous mid-session and the switchboard answers
  // Forbidden (staging 2026-10-20, zesty-ibis). The preview reactor is public
  // and needs no login, so it gets a namespace of its own.
  // The Studio's namespace is the Connect host's `config.renown.namespace`.
  const studioNamespace = (): string => {
    const host = readFileSync(
      new URL('../../../hosts/connect/host.js', import.meta.url),
      'utf8',
    );
    const match = /renown:\s*\{\s*namespace:\s*"([^"]+)"/.exec(host);
    if (!match) throw new Error('hosts/connect/host.js sets no config.renown.namespace');
    return match[1];
  };

  it('keeps the preview Connect out of the Studio Renown session', () => {
    const { command } = reactorProject;
    if (typeof command !== 'function')
      throw new Error('expected command function');
    const cmd = command(buildCtx());
    const previewNamespace = /--renown-namespace\s+(\S+)/.exec(cmd)?.[1];
    expect(previewNamespace).toBeDefined();
    expect(previewNamespace).not.toBe(studioNamespace());
  });
});

// ── reactorProject env — public preview reactor ────────────────────

describe('reactor-project env — public preview reactor', () => {
  it('disables auth so the preview reactor boots OPEN', () => {
    const { env } = reactorProject;
    if (typeof env !== 'function') throw new Error('expected env function');
    const e = env(buildCtx({ switchboardPort: 4001 }));
    expect(e.AUTH_ENABLED).toBe('false');
    expect(e.DOCUMENT_PERMISSIONS_ENABLED).toBe('false');
    expect(e.PORT).toBe('4001');
  });

  it('clears admin/credential/protection hygiene keys', () => {
    const { env } = reactorProject;
    if (typeof env !== 'function') throw new Error('expected env function');
    const e = env(buildCtx({ switchboardPort: 4001 }));
    expect(e.DEFAULT_PROTECTION).toBe('false');
    expect(e.SKIP_CREDENTIAL_VERIFICATION).toBe('false');
    expect(e.ADMINS).toBe('');
  });
});
