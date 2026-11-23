import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTrigger } from "../src/framework.js";
import { lazyCommand, lazyTrigger } from "../src/lazy.js";

type TriggerCtx = Parameters<ReturnType<typeof lazyTrigger>["poll"]>[0];

function routineContext(trigger: ReturnType<typeof lazyTrigger>): TriggerCtx {
  const live = { workdir: "/first" };
  return {
    get context() {
      return live;
    },
    state: trigger.state?.() ?? {},
    reactor: () => Promise.resolve(undefined),
    agent: () => Promise.resolve(undefined),
  } as unknown as TriggerCtx;
}

describe("lazyCommand", () => {
  const meta = {
    id: "echo",
    description: "Echo the text.",
    inputSchema: z.object({ text: z.string() }),
  };

  it("carries the meta and loads the command on its first run", async () => {
    const execute = vi.fn(({ text }: { text: string }) => Promise.resolve({ text }));
    const load = vi.fn(() => Promise.resolve({ execute }));
    const command = lazyCommand(meta, load);

    expect(command.id).toBe("echo");
    expect(command.description).toBe("Echo the text.");
    expect(command.inputSchema).toBe(meta.inputSchema);
    expect(load).not.toHaveBeenCalled();

    const ctx = {} as Parameters<typeof command.execute>[1];
    await expect(command.execute({ text: "hi" }, ctx)).resolves.toEqual({ text: "hi" });
    expect(execute).toHaveBeenCalledWith({ text: "hi" }, ctx);
  });
});

describe("lazyTrigger", () => {
  function counting() {
    const calls: string[] = [];
    const inner = defineTrigger<{ polls: number }>({
      id: "inner",
      type: "condition",
      state: () => ({ polls: 0 }),
      setup: (ctx) => {
        calls.push(`setup:${ctx.context.workdir}`);
        return Promise.resolve();
      },
      poll: (ctx) => {
        ctx.state.polls += 1;
        calls.push(`poll:${ctx.state.polls}`);
        return Promise.resolve(null);
      },
      teardown: (ctx) => {
        calls.push(`teardown:${ctx.state.polls}`);
        return Promise.resolve();
      },
    });
    const load = vi.fn(() => Promise.resolve(inner));
    return { calls, load, trigger: lazyTrigger("inner", load) };
  }

  it("loads at setup and runs the trigger on its own state", async () => {
    const { calls, load, trigger } = counting();
    const ctx = routineContext(trigger);
    expect(trigger.id).toBe("inner");
    expect(load).not.toHaveBeenCalled();

    await trigger.setup?.(ctx);
    await trigger.poll(ctx);
    await trigger.poll(ctx);
    await trigger.teardown?.(ctx);

    expect(load).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["setup:/first", "poll:1", "poll:2", "teardown:2"]);
    expect(ctx.state).not.toHaveProperty("polls");
  });

  it("does nothing before setup", async () => {
    const { calls, load, trigger } = counting();
    const ctx = routineContext(trigger);

    await expect(trigger.poll(ctx)).resolves.toBeNull();
    await trigger.teardown?.(ctx);

    expect(load).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
