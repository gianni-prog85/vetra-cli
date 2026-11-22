/**
 * spec-extract reads the `Wrote <path>` lines of `ph generate --extract`,
 * whatever newline the subprocess ends them with.
 */
import { describe, expect, it } from "vitest";
import { parseWritten } from "../../src/commands/spec/extract.js";

describe("parseWritten", () => {
  it("takes LF and CRLF lines alike", () => {
    expect(parseWritten("Wrote specs/a.phdm.phd\nnoise\nWrote specs/b.phdm.phd\n")).toEqual([
      "specs/a.phdm.phd",
      "specs/b.phdm.phd",
    ]);
    expect(
      parseWritten("Wrote C:\\w\\specs\\a.phdm.phd\r\nnoise\r\nWrote C:\\w\\specs\\b.phdm.phd\r\n"),
    ).toEqual(["C:\\w\\specs\\a.phdm.phd", "C:\\w\\specs\\b.phdm.phd"]);
  });
});
