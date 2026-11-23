import fs from 'node:fs';
import path from 'node:path';
import { resolveRegistryUrl } from '../../cloud/registry-url.js';
import { defineCommand } from '../../framework.js';
import { reactorProjectPublishStatusMeta } from './meta.js';
import { getRegistryToken } from '../../auth/renown.js';
import { resolveCloudConfig } from '../../cloud/config.js';
import { fetchPackument } from '../../cloud/registry-packument.js';
import { projectRoot } from '../../helpers/project.js';

/* Read the registry packument with the agent's Renown token and map the result
 * onto an explicit state — published / not-published / unknown — so the deploy
 * skill can decide reuse-vs-publish without guessing. The token is the same
 * registry-bound credential `reactor-project-publish` uses. */
type PublishCheck =
  | { state: 'published'; version: string }
  | { state: 'not-published' }
  | { state: 'unknown'; reason: string };

interface PublishStatus {
  check: PublishCheck;
  latest: string | null;
}

async function checkPublish(
  registryUrl: string,
  pkgName: string,
  targetVersion: string,
  token: string | null,
): Promise<PublishStatus> {
  const packument = await fetchPackument(registryUrl, pkgName, token);
  if (packument.kind === 'not-found') {
    return { check: { state: 'not-published' }, latest: null };
  }
  if (packument.kind === 'auth-required') {
    return {
      check: {
        state: 'unknown',
        reason: `registry requires auth (HTTP ${packument.status})`,
      },
      latest: null,
    };
  }
  if (packument.kind === 'error') {
    return { check: { state: 'unknown', reason: packument.reason }, latest: null };
  }
  const published = targetVersion in packument.versions;
  return {
    check: published
      ? { state: 'published', version: targetVersion }
      : { state: 'not-published' },
    latest: packument.latest,
  };
}

export const reactorProjectPublishStatus = defineCommand({
  ...reactorProjectPublishStatusMeta,
  execute: async ({ version, registry }, { workdir, config }) => {
    const projectPath = await projectRoot(workdir);
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return {
        text: `**Error:** No package.json found in \`${projectPath}\`. Ensure this is a valid npm package.`,
      };
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      name?: string;
      version?: string;
    };
    const pkgName = packageJson.name;
    if (!pkgName) {
      return {
        text: `**Error:** package.json in \`${projectPath}\` has no "name" field.`,
      };
    }
    const targetVersion = version ?? packageJson.version;
    if (!targetVersion) {
      return {
        text: `**Error:** No version to check — pass \`--version\` or set "version" in \`${packageJsonPath}\`.`,
      };
    }

    const registryUrl = resolveRegistryUrl({
      registry: registry || config.registryUrl,
      projectPath,
    });

    const { renownUrl } = resolveCloudConfig(config);
    const token = await getRegistryToken(workdir, renownUrl, registryUrl);
    const { check, latest } = await checkPublish(
      registryUrl,
      pkgName,
      targetVersion,
      token,
    );

    const head =
      check.state === 'published'
        ? `**Published** — \`${pkgName}@${targetVersion}\` is in the registry. Reuse this publish; bump the version before publishing new changes.`
        : check.state === 'not-published'
          ? `**Not published** — \`${pkgName}@${targetVersion}\` is not in the registry. Publish it with \`reactor-project-publish\` before installing it into an environment.`
          : `**Unknown** — couldn't determine whether \`${pkgName}@${targetVersion}\` is published.\nReason: ${check.reason}\nIf the registry requires auth, authorize the agent (studio "Authorize agent" button) or run \`ph login\` first.`;

    const lines = [
      head,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Package | \`${pkgName}\` |`,
      `| Version checked | \`${targetVersion}\` |`,
      `| Latest published | ${latest ? `\`${latest}\`` : '—'} |`,
      `| Registry | \`${registryUrl}\` |`,
    ];
    return { text: lines.join('\n') };
  },
});
