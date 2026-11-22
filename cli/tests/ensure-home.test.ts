/**
 * The HOME guard fills an unset HOME on POSIX (containers) and leaves the
 * environment alone on Windows, where os.homedir() reads USERPROFILE.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureHome } from "../src/ensure-home.js";

describe("ensureHome", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSIX: an unset HOME becomes the OS user's home", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = {};
    ensureHome(env, "linux", () => "/home/me");
    expect(env.HOME).toBe("/home/me");
    expect(log).toHaveBeenCalledWith("vetra: HOME was unset; defaulted to /home/me");
  });

  it("POSIX: a set HOME is kept", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/root" };
    ensureHome(env, "linux", () => "/home/me");
    expect(env.HOME).toBe("/root");
  });

  it("Windows: HOME stays unset, nothing is printed", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { USERPROFILE: "C:\\Users\\me" };
    ensureHome(env, "win32", () => "C:\\Users\\me");
    expect(env.HOME).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
