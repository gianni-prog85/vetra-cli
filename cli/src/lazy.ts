/**
 * Start-path helpers: commands and triggers whose implementation loads on
 * first use. The Cli definition (cli.ts) imports only what `--help` prints —
 * ids, descriptions, input schemas — and each call site passes a literal
 * `import()`, so the bundler splits the implementation out.
 */
import type { z } from 'zod';
import type { CommandContext, CommandNeeds, Trigger } from '@powerhousedao/clint';
import {
  defineCommand,
  defineTrigger,
  type Config,
  type Registry,
} from './framework.js';

/** A command without its `execute`: what help and the agent's tool list read. */
export interface CommandMeta<TInput extends z.ZodType = z.ZodType> {
  id: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: z.ZodType;
  /**
   * `"reactor"`: the command runs in the Studio that runs for its project,
   * with that Studio's reactor and services (clint's `Command.needs`).
   */
  needs?: CommandNeeds;
  /** Whether the command reads piped input, for this input (`Command.stdin`). */
  stdin?: boolean | ((input: Record<string, unknown>) => boolean);
}

/** The command `meta` describes; `load` imports the module that runs it. */
export function lazyCommand<TInput extends z.ZodType>(
  meta: CommandMeta<TInput>,
  load: () => Promise<{
    execute: (
      input: z.output<TInput>,
      ctx: CommandContext<Config, Registry>,
    ) => Promise<unknown>;
  }>,
) {
  return defineCommand<TInput>({
    ...meta,
    execute: async (input, ctx) => (await load()).execute(input, ctx),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each trigger owns its state, config and registry types
type AnyTrigger = Trigger<any, any, any>;

interface Loaded {
  trigger: AnyTrigger;
  context: Parameters<AnyTrigger['poll']>[0];
}

/**
 * The trigger `id` names; `load` imports it when the routine sets it up.
 * The loaded trigger keeps its own state on a context that reads the
 * routine's live one.
 */
export function lazyTrigger(id: string, load: () => Promise<AnyTrigger>) {
  return defineTrigger<{ loaded?: Promise<Loaded> }>({
    id,
    type: 'condition',
    state: () => ({}),
    setup: async (ctx) => {
      ctx.state.loaded = load().then((trigger) => {
        const state: unknown = trigger.state ? trigger.state() : {};
        return {
          trigger,
          context: Object.create(ctx, {
            state: { value: state, writable: true },
          }) as Loaded['context'],
        };
      });
      const { trigger, context } = await ctx.state.loaded;
      await trigger.setup?.(context);
    },
    poll: async (ctx) => {
      if (!ctx.state.loaded) return null;
      const { trigger, context } = await ctx.state.loaded;
      return trigger.poll(context);
    },
    teardown: async (ctx) => {
      if (!ctx.state.loaded) return;
      const { trigger, context } = await ctx.state.loaded;
      await trigger.teardown?.(context);
    },
  });
}
