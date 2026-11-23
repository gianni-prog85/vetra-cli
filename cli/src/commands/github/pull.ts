import { defineCommand } from '../../framework.js';
import { authedGit, GH_TOKEN_ENV, resolveRepoRemote, shq } from '../../helpers/github.js';
import { githubPullMeta } from './meta.js';

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export const githubPull = defineCommand({
  ...githubPullMeta,
  execute: async ({ branch }, { workdir, config, runProcess }) => {
    if (!BRANCH_PATTERN.test(branch)) {
      throw new Error(`Invalid branch name "${branch}".`);
    }
    const { token, repoFullName, cleanUrl } = await resolveRepoRemote({ workdir, config });
    const git = authedGit();

    const steps: { label: string; command: string }[] = [
      { label: 'git-init', command: 'git init -q' },
      {
        label: 'git-pull',
        command: `${git} pull --ff-only ${shq(cleanUrl)} ${shq(branch)}`,
      },
    ];

    for (const step of steps) {
      const { success, output } = await runProcess(step.command, {
        label: step.label,
        cwd: workdir,
        timeout: 120_000,
        env: { [GH_TOKEN_ENV]: token },
      });
      if (!success) {
        const safe = output.split(token).join('***');
        throw new Error(`${step.label} failed: ${safe}`);
      }
    }

    return { text: `Pulled ${repoFullName} (${branch}).` };
  },
});
