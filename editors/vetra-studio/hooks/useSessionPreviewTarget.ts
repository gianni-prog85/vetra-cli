/**
 * Derive the BUILD pane's preview target from a chat-session document.
 *
 * The agent surfaces a preview to the user by calling `spec-preview-show`.
 * Its tool result carries `{ data: { driveId, documentId, documentSlug,
 * previewUrl } }`. The latest non-error `spec-preview-show` result becomes
 * `{ doc }` (or `{ drive }` for a drive view). The project is the one the
 * Studio runs in, so a target names none.
 *
 * Deliberately *only* `spec-preview-show` — `spec-preview-create` doesn't
 * surface the preview, by design (the agent must explicitly show).
 *
 * `doc` is the slug when available, else the id — same precedence as the
 * URL produced by `spec-preview-show` server-side.
 */
import { useMemo } from "react";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";

const SHOW_TOOL_NAME = "spec-preview-show";

export interface PreviewTarget {
  doc?: string;
  drive?: string;
  /** The project's preview drive root (Connect's drive view): shown once
   *  the project is up, until the agent shares a screen. */
  home?: true;
  /** toolCallId of the spec-preview-show that produced this target — lets
   * consumers tell a NEW show apart from the same one re-rendered, even when
   * doc is unchanged. */
  callId: string;
}

interface ShowToolResultData {
  data?: {
    driveId?: string;
    documentId?: string | null;
    documentSlug?: string | null;
    previewUrl?: string;
    kind?: string;
  };
}

export function useSessionPreviewTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  return useMemo(() => extractPreviewTarget(session), [session?.state]);
}

/**
 * Pure extraction logic — exported separately so it can be unit-tested
 * without spinning up a React renderer. The hook above is a thin `useMemo`
 * over this function.
 */
export function extractPreviewTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  if (!session) return undefined;
  const messages = session.state.global.messages;
  if (messages.length === 0) return undefined;

  // Walk backwards to the first non-error spec-preview-show TOOL_RESULT.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_RESULT") continue;
      if (part.toolName !== SHOW_TOOL_NAME) continue;
      if (part.isError) continue;
      if (!part.toolCallId || !part.result) continue;

      const data = safeParse<ShowToolResultData>(part.result)?.data;

      if (data?.kind === "drive" && data.driveId) {
        return { drive: data.driveId, callId: part.toolCallId };
      }

      const doc = data?.documentSlug ?? data?.documentId;
      if (!doc) continue;
      return { doc, callId: part.toolCallId };
    }
  }
  return undefined;
}

const START_TOOL_NAME = "reactor-project-start";

/**
 * The project's start (the latest `reactor-project-start` that didn't fail),
 * as a `home` target: the pane shows the project's Connect drive view as soon
 * as its preview is up, instead of waiting for the first `spec-preview-show`.
 * Undefined when no start succeeded.
 */
export function extractProjectHomeTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  if (!session) return undefined;
  const messages = session.state.global.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_RESULT") continue;
      if (part.toolName !== START_TOOL_NAME) continue;
      if (part.isError || !part.toolCallId || !part.result) continue;
      const result = safeParse<{ text?: string }>(part.result);
      // The start command reports a failed start as text, not as an error.
      const text = result ? result.text : part.result;
      if (text?.trimStart().startsWith("✗")) continue;
      return { home: true, callId: part.toolCallId };
    }
  }
  return undefined;
}

/** The pane's home target, memoised on the session state. */
export function useProjectHomeTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  return useMemo(() => extractProjectHomeTarget(session), [session?.state]);
}

function safeParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
