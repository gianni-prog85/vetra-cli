/**
 * Who the Cli writes as on the Studio switchboard: the agent's Renown
 * identity in a cloud Studio, nothing in a local one.
 */
import { describe, it, expect, vi } from "vitest";
import type { IRenown } from "@renown/sdk/node";
import { studioIdentity } from "../../src/auth/studio-identity.js";

const OWNER = "0xabc0000000000000000000000000000000000001";

function fakeRenown(address?: string) {
  const listeners = new Set<() => void>();
  const signer = { user: address ? { address } : undefined, app: { key: "did:key:z6MkAgent" } };
  const renown = {
    signer,
    get user() {
      return signer.user;
    },
    getBearerToken: vi.fn(() => Promise.resolve("bearer-1")),
    on: (_event: "user", listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAddress(next?: string) {
      signer.user = next ? { address: next } : undefined;
      for (const listener of listeners) listener();
    },
  };
  const getRenown = vi.fn(() => Promise.resolve(renown as unknown as IRenown));
  return { renown, getRenown, listeners };
}

const setup = (config: Record<string, unknown>) => ({ workdir: "/work", config });

describe("studioIdentity", () => {
  it("gives a local Studio no identity and builds no Renown", async () => {
    const { getRenown } = fakeRenown(OWNER);
    expect(await studioIdentity(setup({}), { getRenown, env: {} })).toBeUndefined();
    expect(getRenown).not.toHaveBeenCalled();
  });

  it("signs a cloud Studio's writes with the agent's Renown signer", async () => {
    const { renown, getRenown } = fakeRenown(OWNER);
    const identity = await studioIdentity(
      setup({ environmentId: "env-1", cloudRenownUrl: "https://renown.test" }),
      { getRenown, env: {} },
    );
    expect(identity?.signer).toBe(renown.signer);
    expect(identity?.legacyDocuments).toBe("refuse");
    expect(getRenown).toHaveBeenCalledWith("/work", "https://renown.test");
    expect(await identity?.tokenProvider()).toBe("bearer-1");
  });

  it("sends no bearer until the agent is authorized", async () => {
    const { renown, getRenown } = fakeRenown();
    const identity = await studioIdentity(setup({}), {
      getRenown,
      env: { VETRA_ENVIRONMENT_ID: "env-1" },
    });
    expect(await identity?.tokenProvider()).toBeUndefined();
    expect(renown.getBearerToken).not.toHaveBeenCalled();
  });

  it("reports the owner's sign-in through onSignerChange, until unsubscribed", async () => {
    const { renown, getRenown, listeners } = fakeRenown();
    const identity = await studioIdentity(setup({ environmentId: "env-1" }), {
      getRenown,
      env: {},
    });
    const listener = vi.fn();
    const unsubscribe = identity!.onSignerChange(listener);
    renown.setAddress(OWNER);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
