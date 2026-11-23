import { lazyCommand } from '../../lazy.js';
import { githubCloneMeta, githubPullMeta, githubPushMeta } from './meta.js';

export const githubCommands = [
  lazyCommand(githubPushMeta, async () => (await import('./push.js')).githubPush),
  lazyCommand(githubPullMeta, async () => (await import('./pull.js')).githubPull),
  lazyCommand(githubCloneMeta, async () => (await import('./clone.js')).githubClone),
];
