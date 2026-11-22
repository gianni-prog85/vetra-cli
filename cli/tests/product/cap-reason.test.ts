/**
 * capReason keeps local paths out of stored reasons on both platforms. A
 * Windows path is matched in any case and with either separator, since tools
 * print both `C:\Users\…` and `C:/Users/…`.
 */
import { describe, expect, it } from "vitest";
import { capReason } from "../../src/product/check-results.js";

describe("capReason roots", () => {
  it("windows: the project base in either separator and any case becomes relative", () => {
    const base = "C:\\Users\\me\\work\\todo";
    const text = "Broke C:/Users/me/work/todo/editors/a.tsx and c:\\users\\ME\\work\\todo\\editors\\b.tsx";
    expect(capReason(text, { base, platform: "win32" })).toBe("Broke editors/a.tsx and editors\\b.tsx");
  });

  it("windows: another absolute path is cut to its file name", () => {
    expect(capReason("Failed in D:/other/place/x.ts", { base: "C:\\w", platform: "win32" })).toBe(
      "Failed in x.ts",
    );
  });

  it("posix: the base matches as written, case and all", () => {
    expect(capReason("Broke /srv/todo/editors/a.tsx", { base: "/srv/todo", platform: "linux" })).toBe(
      "Broke editors/a.tsx",
    );
    // Another case is another directory on POSIX: an absolute path, cut to its name.
    expect(capReason("Broke /SRV/todo/editors/a.tsx", { base: "/srv/todo", platform: "linux" })).toBe(
      "Broke a.tsx",
    );
  });
});
