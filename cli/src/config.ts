import { readPackageInfo } from '@powerhousedao/clint';

const pkg = readPackageInfo(import.meta.url);

export const CLI_ROOT = pkg.root;
// A literal, not the package name: it is the VETRA_* env prefix, the
// `.ph/vetra` store folder and the name in messages.
export const CLI_NAME = 'vetra';
export const CLI_VERSION = pkg.version;
