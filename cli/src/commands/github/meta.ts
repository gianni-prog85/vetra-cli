/** Ids, descriptions and input schemas of the GitHub commands (see ../spec/meta.ts). */
import { z } from 'zod';

export const githubPushMeta = {
  id: 'github-push',
  description:
    'Commit the workspace and push it to the GitHub repo connected to this studio environment, as the Vetra bot.',
  inputSchema: z.object({
    branch: z.string().default('main').describe('Remote branch to push to'),
    message: z
      .string()
      .default('Update from Vetra Studio')
      .describe('Commit message for the pushed changes'),
  }),
};

export const githubPullMeta = {
  id: 'github-pull',
  description:
    'Fast-forward the workspace with the latest changes from the GitHub repo connected to this studio environment.',
  inputSchema: z.object({
    branch: z.string().default('main').describe('Remote branch to pull'),
  }),
};

export const githubCloneMeta = {
  id: 'github-clone',
  description:
    'Clone the GitHub repo connected to this studio environment into the workspace, for a fresh (non-persisted) environment.',
  inputSchema: z.object({}),
};
