import { defineCommand } from '../../framework.js';
import { reactorProjectPublishMeta } from './meta.js';
import { resolveCloudConfig } from '../../cloud/config.js';
import { projectRoot } from '../../helpers/project.js';
import { publishReactorProject } from './publish-core.js';

export const reactorProjectPublish = defineCommand({
  ...reactorProjectPublishMeta,
  execute: async (
    { version, registry, tag, skipBuild, dryRun, log },
    { workdir, config, stdout },
  ) => {
    const projectPath = await projectRoot(workdir);
    const { renownUrl } = resolveCloudConfig(config);

    const result = await publishReactorProject({
      projectPath,
      workdir,
      renownUrl,
      registry: registry || config.registryUrl,
      version,
      tag,
      skipBuild,
      dryRun,
      log: log ? stdout : undefined,
    });

    if (result.kind === 'no-package' || result.kind === 'auth-required') {
      return { text: `**Error:** ${result.error}` };
    }
    if (result.kind === 'failed') {
      return {
        text: ['**Publish failed**', '', '```', result.error, '```'].join('\n'),
      };
    }

    const lines = [
      dryRun ? '**Dry run complete**' : '**Published successfully**',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Package | \`${result.packageName}\` |`,
      `| Version | \`${result.version}\` |`,
      `| Registry | \`${result.registry}\` |`,
      tag ? `| Tag | \`${tag}\` |` : null,
      dryRun ? `| Mode | dry-run |` : null,
    ].filter((l) => l !== null);

    return { text: lines.join('\n') };
  },
});
