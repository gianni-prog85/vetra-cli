// Side-effecting HOME guard. Imported first by cli/index.ts so it runs before the
// rest of the import graph (Vite/chokidar) reads HOME. A container that starts
// vetra-cli with HOME unset or empty makes chokidar throw a spurious ENOSPC on
// the first watched file, since os.homedir() resolves to "". Resolve a usable
// home from the OS user table and export it back into the environment.
//
// POSIX only: on Windows os.homedir() reads USERPROFILE and HOME is normally
// unset; one set here would also move where the children's Git for Windows
// reads its config (it prefers HOME over HOMEDRIVE/HOMEPATH).
import { userInfo } from 'node:os';

function resolveHome(): string | undefined {
  try {
    const home = userInfo().homedir;
    if (home && home !== '/') return home;
  } catch {
    // userInfo() can throw on a uid missing from /etc/passwd.
  }
  return undefined;
}

export function ensureHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  resolve: () => string | undefined = resolveHome,
): void {
  if (platform === 'win32' || env.HOME) return;
  const home = resolve();
  if (home) {
    env.HOME = home;
    console.log(`vetra: HOME was unset; defaulted to ${home}`);
  } else {
    console.warn(
      'vetra: HOME is unset and could not be resolved from the OS user; ' +
        'file watching may fail. Set HOME in the container environment.',
    );
  }
}

ensureHome();
