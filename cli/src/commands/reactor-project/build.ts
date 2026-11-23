import fs from 'node:fs';
import path from 'node:path';
import { createProcessManager } from '@powerhousedao/clint';
import { defineCommand } from '../../framework.js';
import { reactorProjectBuildMeta } from './meta.js';
import { projectRoot } from '../../helpers/project.js';
import { formatProcessFailure } from '../../helpers/cli-errors.js';
import { phBuildNodeOptions } from '../../helpers/node-memory.js';

export interface BuildResult {
  success: boolean;
  /** Combined stdout/stderr captured from `ph build`. */
  output: string;
}

/**
 * Run `ph build` in the given project directory.
 * Streams output via the `onData` callback.
 */
export async function runBuild(
  projectPath: string,
  onData?: (chunk: string) => void,
): Promise<BuildResult> {
  const pm = createProcessManager();
  const { success, output } = await pm.run('ph build', {
    label: 'ph-build',
    timeout: 120_000,
    cwd: projectPath,
    env: { FORCE_COLOR: '1', NODE_OPTIONS: phBuildNodeOptions() },
    onOutput: onData ? (line) => onData(line + '\n') : undefined,
  });
  return { success, output };
}

export const reactorProjectBuild = defineCommand({
  ...reactorProjectBuildMeta,
  execute: async (_input, { workdir, runProcess }) => {
    const projectPath = await projectRoot(workdir);

    const { success, output } = await runProcess('ph build', {
      label: 'ph-build',
      timeout: 120_000,
      cwd: projectPath,
      env: { FORCE_COLOR: '1', NODE_OPTIONS: phBuildNodeOptions() },
    });

    if (!success) {
      throw new Error(
        formatProcessFailure('ph build failed', 'ph build', projectPath, output),
      );
    }

    const hasDistDir = fs.existsSync(path.join(projectPath, 'dist'));
    if (hasDistDir) {
      return {
        text: `**Build successful** — output at \`dist\``,
      };
    }
    return { text: `**Build completed** (exit code 0)` };
  },
});
