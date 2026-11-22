import { describe, expect, it } from "vitest";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import {
  extractPreviewTarget,
  extractProjectHomeTarget,
} from "./useSessionPreviewTarget.js";

type Message = ChatSessionDocument["state"]["global"]["messages"][number];
type ContentPart = Message["content"][number];

function makeSession(messages: Message[]): ChatSessionDocument {
  /* The extractor only reads state.global.messages — the rest of the
   * document shape is irrelevant. Cast through unknown to satisfy the full
   * type. */
  return {
    state: { global: { messages } } as never,
  } as unknown as ChatSessionDocument;
}

function part(overrides: Partial<ContentPart>): ContentPart {
  return {
    id: "p",
    type: "TEXT",
    text: null,
    toolCallId: null,
    toolName: null,
    args: null,
    result: null,
    isError: null,
    mediaType: null,
    url: null,
    attachment: null,
    filename: null,
    error: null,
    ...overrides,
  };
}

function msg(role: Message["role"], content: ContentPart[]): Message {
  return {
    id: `m-${Math.random()}`,
    role,
    content,
    stepIndex: null,
    createdAt: "2026-05-25T12:00:00.000Z",
    usage: null,
    finishedAt: null,
    finishReason: null,
    failure: null,
    pickedUpAt: null,
  };
}

function showCall(
  toolCallId: string,
  args: Record<string, unknown>,
): ContentPart {
  return part({
    id: `call-${toolCallId}`,
    type: "TOOL_CALL",
    toolCallId,
    toolName: "spec-preview-show",
    args: JSON.stringify(args),
  });
}

function showResult(
  toolCallId: string,
  data: Record<string, unknown> | null,
  opts?: { isError?: boolean },
): ContentPart {
  return part({
    id: `res-${toolCallId}`,
    type: "TOOL_RESULT",
    toolCallId,
    toolName: "spec-preview-show",
    result: data === null ? null : JSON.stringify({ data }),
    isError: opts?.isError ?? false,
  });
}

describe("extractPreviewTarget", () => {
  it("returns undefined for an empty session", () => {
    expect(extractPreviewTarget(makeSession([]))).toBeUndefined();
  });

  it("returns undefined when no spec-preview-show has fired", () => {
    const session = makeSession([
      msg("USER", [part({ id: "1", type: "TEXT", text: "hi" })]),
      msg("ASSISTANT", [
        part({
          id: "2",
          type: "TOOL_CALL",
          toolCallId: "x",
          toolName: "spec-preview-create",
          args: JSON.stringify({ name: "p1" }),
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("extracts the doc from the latest successful spec-preview-show", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", { name: "Bench Day" })]),
      msg("TOOL", [
        showResult("c1", {
          driveId: "preview-abcd1234",
          documentId: "doc-7",
          documentSlug: "bench-day",
          previewUrl:
            "http://localhost:3001/d/preview-abcd1234/bench-day?embed=1",
        }),
      ]),
    ]);
    // The project is the Studio's own: the target names none.
    expect(extractPreviewTarget(session)).toEqual({
      doc: "bench-day",
      callId: "c1",
    });
  });

  it("falls back to documentId when documentSlug is null", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", {})]),
      msg("TOOL", [
        showResult("c1", {
          driveId: "preview-x",
          documentId: "doc-only-id",
          documentSlug: null,
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toEqual({
      doc: "doc-only-id",
      callId: "c1",
    });
  });

  it("prefers the most recent result and skips errored ones", () => {
    const session = makeSession([
      // older successful call
      msg("ASSISTANT", [showCall("c1", { name: "Old" })]),
      msg("TOOL", [
        showResult("c1", { driveId: "preview-old", documentSlug: "old-doc" }),
      ]),
      // newer errored call — should be ignored
      msg("ASSISTANT", [showCall("c2", { name: "Errored" })]),
      msg("TOOL", [showResult("c2", null, { isError: true })]),
      // newest successful call — should win
      msg("ASSISTANT", [showCall("c3", { name: "Newest" })]),
      msg("TOOL", [
        showResult("c3", {
          driveId: "preview-newest",
          documentSlug: "newest-doc",
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toEqual({
      doc: "newest-doc",
      callId: "c3",
    });
  });

  it("a drive view is a drive target", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", {})]),
      msg("TOOL", [showResult("c1", { kind: "drive", driveId: "drv-1" })]),
    ]);
    expect(extractPreviewTarget(session)).toEqual({
      drive: "drv-1",
      callId: "c1",
    });
  });

  it("ignores results that name no document", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", {})]),
      msg("TOOL", [showResult("c1", { driveId: "drv" })]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("ignores results whose JSON is malformed", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", {})]),
      msg("TOOL", [
        part({
          id: "broken",
          type: "TOOL_RESULT",
          toolCallId: "c1",
          toolName: "spec-preview-show",
          result: "not valid json {",
          isError: false,
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("ignores tool results from other tools (e.g. spec-preview-create)", () => {
    const session = makeSession([
      msg("ASSISTANT", [
        part({
          id: "call",
          type: "TOOL_CALL",
          toolCallId: "c1",
          toolName: "spec-preview-create",
          args: JSON.stringify({}),
        }),
      ]),
      msg("TOOL", [
        part({
          id: "res",
          type: "TOOL_RESULT",
          toolCallId: "c1",
          toolName: "spec-preview-create",
          result: JSON.stringify({
            data: { driveId: "x", document: { header: { id: "y" } } },
          }),
          isError: false,
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });
});

function startCall(
  toolCallId: string,
  args: Record<string, unknown>,
): ContentPart {
  return part({
    id: `call-${toolCallId}`,
    type: "TOOL_CALL",
    toolCallId,
    toolName: "reactor-project-start",
    args: JSON.stringify(args),
  });
}

function startResult(
  toolCallId: string,
  result: Record<string, unknown> | string,
  opts?: { isError?: boolean },
): ContentPart {
  return part({
    id: `res-${toolCallId}`,
    type: "TOOL_RESULT",
    toolCallId,
    toolName: "reactor-project-start",
    result: typeof result === "string" ? result : JSON.stringify(result),
    isError: opts?.isError ?? false,
  });
}

describe("extractProjectHomeTarget", () => {
  it("is undefined before the project is started", () => {
    expect(extractProjectHomeTarget(undefined)).toBeUndefined();
    expect(extractProjectHomeTarget(makeSession([]))).toBeUndefined();
  });

  it("is the project's home once a start succeeded", () => {
    const session = makeSession([
      msg("ASSISTANT", [startCall("s1", {})]),
      msg("TOOL", [
        startResult("s1", {
          text: "reactor-project ready",
          data: { projectPath: "/abs/todo-list" },
        }),
      ]),
    ]);
    expect(extractProjectHomeTarget(session)).toEqual({
      home: true,
      callId: "s1",
    });
  });

  it("skips failed starts and falls back to an earlier good one", () => {
    const session = makeSession([
      msg("ASSISTANT", [startCall("s1", {})]),
      msg("TOOL", [startResult("s1", { text: "ready" })]),
      msg("ASSISTANT", [startCall("s2", {})]),
      msg("TOOL", [
        startResult("s2", { text: "✗ reactor-project: port in use" }),
      ]),
      msg("ASSISTANT", [startCall("s3", {})]),
      msg("TOOL", [startResult("s3", "boom", { isError: true })]),
    ]);
    expect(extractProjectHomeTarget(session)).toEqual({
      home: true,
      callId: "s1",
    });
  });

  it("is undefined when every start failed", () => {
    const session = makeSession([
      msg("ASSISTANT", [startCall("s1", {})]),
      msg("TOOL", [startResult("s1", { text: "✗ The project run is off" })]),
    ]);
    expect(extractProjectHomeTarget(session)).toBeUndefined();
  });
});
