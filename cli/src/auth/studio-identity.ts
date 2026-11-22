/**
 * Who the Cli writes as on the Studio switchboard.
 *
 * A cloud Studio (an environment id is set) attaches with the agent's Renown
 * identity: its signer, a bearer per request, and a watch on the signer's
 * user, so the agent starts writing once the owner authorizes it ("Authorize
 * agent"; clint emits `powerhouse:writes:ready`). It writes no legacy
 * document. A local Studio passes none of this: no keypair is written at
 * start, and writes go out unsigned.
 *
 * Limit (clint `RemoteReactorConfig.signer`): while the signer has no user
 * every write is refused, a legacy one included, so a signer is given only to
 * a cloud Studio, whose switchboard creates `v2-required` documents.
 */
import type { IRenown, ISigner } from "@renown/sdk/node";
import { resolveCloudConfig } from "../cloud/config.js";
import type { Config } from "../framework.js";
import { getRenown } from "./renown.js";
import { isCloudStudio } from "./studio-mode.js";

/** The identity part of the Cli's `configureReactor.remote`. */
export interface StudioIdentity {
  signer: ISigner;
  tokenProvider: () => Promise<string | undefined>;
  onSignerChange: (listener: () => void) => () => void;
  legacyDocuments: "refuse";
}

/** What the identity reads from clint's reactor setup context. */
export interface StudioIdentitySetup {
  workdir: string;
  config: Record<string, unknown>;
}

export interface StudioIdentityDeps {
  /** Tests: the workdir's Renown instance. */
  getRenown?: (workdir: string, renownUrl: string) => Promise<IRenown>;
  env?: NodeJS.ProcessEnv;
}

/**
 * The agent's identity for a cloud Studio, or undefined for a local one. The
 * bearer and the user are read through `getRenown` on every call, so the owner
 * rule (`auth/renown.ts`) applies to each request.
 */
export async function studioIdentity(
  setup: StudioIdentitySetup,
  deps: StudioIdentityDeps = {},
): Promise<StudioIdentity | undefined> {
  if (!isCloudStudio(setup.config, deps.env)) return undefined;
  const renownOf = deps.getRenown ?? getRenown;
  // The Renown the agent's login flow uses (`/auth/*`), so one instance per workdir.
  const { renownUrl } = resolveCloudConfig(setup.config as Pick<Config, "cloudRenownUrl">);
  const renown = await renownOf(setup.workdir, renownUrl);
  return {
    signer: renown.signer,
    tokenProvider: async () => {
      const current = await renownOf(setup.workdir, renownUrl);
      if (!current.user) return undefined;
      return current.getBearerToken({ expiresIn: 600 });
    },
    onSignerChange: (listener) => renown.on("user", () => listener()),
    legacyDocuments: "refuse",
  };
}
