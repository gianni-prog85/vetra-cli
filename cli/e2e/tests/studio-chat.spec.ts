import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRemoteAttachmentService } from "@powerhousedao/reactor-attachments/client";
import {
  assertNoReplayError,
  dismissCookieBanner,
  startConversation,
  studioPage,
} from "../support/studio-page.js";
import {
  cliPaths,
  loadFixture,
  loadRun,
  replayDoneText,
  studioGraphql,
} from "../support/target.js";

/**
 * The chat round trip without an LLM key. A conversation in the Agent panel
 * starts the agent; the replay agent (chat-spec fixture) writes a
 * document-model spec into the project through the real spec commands and
 * closes with its done text. Then a file goes into the conversation and the
 * Cli extracts it to disk.
 *
 * The file is sent the way the chat box sends one: reserve and upload through
 * Connect's origin, then the user message with a FILE part naming the ref.
 */
const fixture = loadFixture();
const run = loadRun();
const studioHome = `${run.baseUrl}/d/${run.driveId}`;
const { workdir, log } = cliPaths();

type FoundDocument = {
  id: string;
  name: string;
  documentType: string;
  state: Record<string, unknown>;
};

const FIND_DOCUMENTS = `query ($type: String!, $parentId: String!) {
  findDocuments(search: { type: $type, parentId: $parentId }) {
    items { id name documentType state }
  }
}`;

const EXECUTE = `mutation ($id: String!, $actions: [ActionInput!]!) {
  execute(documentIdOrSlug: $id, actions: $actions) { id }
}`;

async function findInStudio(type: string): Promise<FoundDocument[]> {
  const data = await studioGraphql<{
    findDocuments: { items: FoundDocument[] };
  }>(run.baseUrl, FIND_DOCUMENTS, { type, parentId: run.driveId });
  return data.findDocuments.items;
}

/** The document-model state's global scope (`state.global`, or the state). */
function globalState(doc: FoundDocument): Record<string, unknown> {
  const global = doc.state.global;
  return global && typeof global === "object"
    ? (global as Record<string, unknown>)
    : doc.state;
}

function readLog(): string {
  if (!log) return "";
  try {
    return readFileSync(log, "utf8");
  } catch {
    return "";
  }
}

test.describe("Vetra studio — chat round trip", () => {
  test.skip(
    !fixture.spec || !fixture.attachment,
    `fixture "${fixture.name}" has no spec and attachment: boot with VETRA_FIXTURE=chat-spec`,
  );

  test("a conversation to a spec in the project, and a chat file extracted by the Cli", async ({
    page,
  }) => {
    const spec = fixture.spec!;
    const attachment = fixture.attachment!;
    const done = replayDoneText(fixture);
    expect(done, "the replay fixture has a done text").toBeTruthy();

    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);
    const conversation = await startConversation(page, fixture.prompt);

    // The replay ran: the agent's closing text is in the conversation. The
    // chat watch heard the first message over the realtime socket (no poll
    // fallback for a first message).
    const doneLine = conversation.getByText(done!).first();
    await expect
      .poll(
        async () => {
          assertNoReplayError(log);
          return doneLine.isVisible();
        },
        { timeout: 180_000, intervals: [1_000, 2_000] },
      )
      .toBe(true);
    console.log("[e2e] the agent's done text shows");

    // The spec document is in the Studio drive, with spec-update's state.
    let specDoc: FoundDocument | undefined;
    await expect
      .poll(
        async () => {
          specDoc = (await findInStudio(spec.documentType)).find(
            (doc) => doc.name === spec.name,
          );
          return specDoc ? globalState(specDoc) : null;
        },
        { timeout: 60_000, intervals: [1_000, 2_000] },
      )
      .toMatchObject({ id: spec.modelId, name: spec.name, description: spec.description });
    console.log(`[e2e] spec ${specDoc?.id} in the Studio drive`);

    // The explorer lists it with the project's specifications.
    await expect(
      studioPage(page).tree.getByText(spec.name, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    // The drive is its only place: the spec commands write no specs/ folder.
    if (workdir) {
      expect(existsSync(path.join(workdir, "specs")), "the project's specs/").toBe(false);
    }

    // The conversation: the drive's only chat session.
    const sessions = await findInStudio("powerhouse/chat-session");
    expect(sessions).toHaveLength(1);
    const sessionId = sessions[0].id;

    // Upload the file and send it in the conversation, as the chat box does.
    const attachments = createRemoteAttachmentService({ remoteUrl: run.baseUrl });
    const upload = await attachments.reserve({
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
    });
    const { ref } = await upload.send(
      new Blob([attachment.content], { type: attachment.mimeType }),
    );
    expect(ref).toMatch(/^attachment:\/\/v1:[0-9a-f]{64}$/);
    const filePartId = randomUUID();
    const at = new Date().toISOString();
    await studioGraphql(run.baseUrl, EXECUTE, {
      id: sessionId,
      actions: [
        {
          id: randomUUID(),
          type: "ADD_USER_MESSAGE",
          scope: "global",
          // An ISO date, as document-model's action creators write it.
          timestampUtcMs: at,
          input: {
            id: randomUUID(),
            createdAt: at,
            content: [
              { id: randomUUID(), type: "TEXT", text: attachment.text },
              {
                id: filePartId,
                type: "FILE",
                filename: attachment.fileName,
                mediaType: attachment.mimeType,
                attachment: ref,
              },
            ],
          },
        },
      ],
    });
    console.log(`[e2e] sent ${ref} in conversation ${sessionId}`);

    // The tab hears the message: the conversation shows it.
    await expect(conversation.getByText(attachment.text).first()).toBeVisible({
      timeout: 60_000,
    });

    if (!log || !workdir) {
      test.info().annotations.push({
        type: "skipped-check",
        description:
          "attached without VETRA_E2E_LOG and VETRA_E2E_WORKDIR: the extraction is not checked",
      });
      return;
    }

    // The Cli read the file through the conversation and wrote it to disk.
    await expect
      .poll(() => /extracted 1 attachment\(s\)/.test(readLog()), {
        timeout: 60_000,
        intervals: [1_000, 2_000],
      })
      .toBe(true);
    const base = attachment.fileName.replace(/\.[^.]+$/, "");
    // The Cli's own folder, never the project's tree.
    const extracted = path.join(
      workdir,
      ".ph",
      "vetra",
      "downloads",
      `${base}_${filePartId.slice(0, 6)}${path.extname(attachment.fileName)}`,
    );
    expect(readFileSync(extracted, "utf8")).toBe(attachment.content);
    console.log(`[e2e] extracted to ${extracted}`);

    // The realtime socket stayed up for the whole run.
    expect(readLog()).not.toContain("realtime document changes are unavailable");
  });
});
