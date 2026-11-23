/** Id, description and input schema of `product-progress` (see ../spec/meta.ts). */
import { z } from "zod";

const stepKind = z.enum(["PLAN", "DATA", "EDITORS", "TESTS", "LIVE"]);

export const productProgressMeta = {
  id: "product-progress",
  description:
    "Record build progress on the Studio's product: plan the steps, start/count/finish a step, go back, add a milestone in the customer's words, report being stuck, name the product, title the change, suggest 2–3 next improvements at the end of the Tests step. `done` is refused until the step's checks pass; the reply says why. `start`/`done`/`back` replies name the tools that just became available.",
  inputSchema: z.object({
    action: z
      .enum(["plan", "start", "count", "done", "back", "milestone", "stuck", "suggest", "name", "title"])
      .describe(
        "plan: set the steps (`steps`). start: begin `step` (optional `label`). count: progress on `step` (`done` of `total`). done: finish `step` (refused until its checks pass). back: return to a finished `step` (`reason`). milestone: one finished thing in the customer's words (`text`). stuck: after 3 failed attempts at the same thing (`reason`, `tried`). name: name the product (`text`, before finishing PLAN). title: title this change (`text`, before finishing PLAN). suggest: at the end of the Tests step, 2–3 small next improvements the customer could ask for (`items`, each one change, at most 80 characters, in the customer's words).",
      ),
    step: stepKind.optional().describe("The step this action is about."),
    steps: z
      .array(z.object({ kind: stepKind, total: z.number().int().min(0).optional() }))
      .optional()
      .describe("For plan: the steps of this change, in order, with optional item totals."),
    label: z.string().optional().describe("For start: what is being worked on now."),
    done: z.number().int().min(0).optional().describe("For count: items finished."),
    total: z.number().int().min(0).optional().describe("For count: items in the step."),
    reason: z.string().optional().describe("For back and stuck: why."),
    tried: z.array(z.string()).optional().describe("For stuck: what was tried."),
    text: z.string().optional().describe("For milestone, name and title."),
    items: z.array(z.string()).optional().describe("For suggest: 2–3 ideas, each at most 80 characters."),
  }),
};
