# vetra — agent instructions

This directory holds three durable documents that together carry the project
state across sessions. Read them in this order at the start of any
non-trivial session:

1. **`ARCHITECTURE.md`** — the durable map of how the pieces fit together
   (embedded reactor, Switchboard, Connect, local-registry, triggers,
   services, publish flow, dynamic package loading). Update it when the
   shape of the system changes, not when day-to-day work happens.

2. **`HANDOFF.md`** — the rolling state of in-progress work on the
   publish-pipeline / dynamic-load chain. Treat it as a long-running thread
   shared across sessions: it records decisions, files changed, known
   issues, test plans, and open gaps. **Keep it current.** When you finish a
   chunk of work, update the relevant sections (Architecture decisions,
   Files changed, Known issues, Things NOT done, Suggested next steps) so
   the next session can pick up cold. Honor the "Ground rules" section at
   the top — it captures durable preferences from the user.

3. **`TODO.md`** — short backlog of follow-ups and migrations that aren't
   yet scheduled. Promote items into HANDOFF when active.

## Updating the docs

- **`TODO.md`** — when you notice something worth tracking (a follow-up,
  a migration, a quick-fix idea), suggest it to the user and ask for
  confirmation before adding it. Don't write to `TODO.md` unprompted.
- **`HANDOFF.md`** — tracks the in-progress publish-pipeline / dynamic-load
  thread specifically. Only update it when the work you just did materially
  shifts that thread: a decision changed, a known issue was resolved or newly
  discovered, a "Things NOT done" item flipped state, a file in the publish /
  reactor / Switchboard / Connect / triggers / registry chain changed in a way
  the next session needs to know. Do **not** log routine work, prompt
  tweaks, tool-description edits, agent-session reviews, or anything
  unrelated to the publish-pipeline thread — those go in commit messages or
  stay in the conversation. When in doubt, ask. When you do update, tell the
  user at end-of-turn which sections moved.
- **`ARCHITECTURE.md`** — update in the same commit as the code change
  that shifted the architecture.

## When to use what

- **Full session on the publish pipeline or anything touching the
  reactor / Switchboard / Connect / triggers / registry** → read all
  three.
- **Short parallel session for a quick fix** (typo, isolated bug, small
  refactor in a spec command, etc.) → skip the three docs unless the
  change clearly intersects with the publish flow. If you discover the
  fix is bigger than expected, stop and read them.
- **Architectural change** → update `ARCHITECTURE.md` in the same
  commit as the code change.
- **Work in progress that won't finish this session** → leave a note in
  `HANDOFF.md` so the next session starts with context.

## Cross-repo context

The runtime composition spans two checkouts: vetra-cli and the Powerhouse
monorepo (`packages/clint`, `packages/clint-common`, `apps/switchboard`,
`apps/connect`). See `ARCHITECTURE.md` → "Repositories" for paths.
`workspace/local-link/link.sh` links the monorepo packages locally; a
rebuild there is picked up when the Cli restarts.

## Dev daemon model & rebuilds

`pnpm dev` (`tsx cli/src/main.ts`) runs the Cli in the foreground through
clint's `runCli`, attached to the switchboard drive `VETRA_SWITCHBOARD_URL`
names, and dies on Ctrl+C. It starts no Switchboard, Connect or
`vetra-studio` service of its own: those are hosts from B2 (see
`ARCHITECTURE.md`). reactor-project previews are child services clint's
service manager tracks and stops; don't `pkill -f` them.

Two non-obvious bundle facts:
- **`dist/` is gitignored build output.** The browser client's sync
  query (`PollSyncEnvelopes`) is baked into the Studio bundle
  (`dist/connect`), **not** the node-side packages. `pnpm build:connect`
  is `ph connect build`, i.e. `ph run connect build` over
  `hosts/connect`: it builds the package again, then the SPA into
  `dist/connect`. `pnpm build` leaves `dist/connect` and `dist/skills`
  in place (it cleans `dist/browser` and `dist/node` only).
- The node-side routine poll and the browser poll are **separate code
  paths**. Verifying one does not verify the other — exercise the
  browser (load `/d/<drive-id>` and check the `pollSyncEnvelopes` POST)
  when the symptom is browser-facing.

When verifying a fix, restart the daemon, hard-load the Studio in a
browser, and confirm the actual request — don't infer from boot logs.

## Iterating: what each change needs

The reload story differs by what you edit. Match the change to the
loop before assuming something is broken — most "nothing happens" reports
are a stale artifact, not a real bug.

| You changed… | To see it |
|---|---|
| Studio UI / editors / document models (`editors/`, `document-models/`) | `pnpm build` (the switchboard loads the package from `dist/node`) and `pnpm build:connect`, then restart the stack (`ph run studio`). `ph run studio dev` serves the sources through Vite instead. |
| Cli source (`cli/src/` — CLI, agents, triggers) | Restart the REPL: Ctrl+C, `pnpm dev`. `dev` is `tsx cli/src/main.ts` (no build step). The stack's Cli runs the built `./cli`: `pnpm build`, then restart it. |
| **Agents or skills** (`cli/src/cli.ts` `prompts.agents`, anything under `prompts/`) | `pnpm build`, or only its last step, `pnpm exec ph-cli run cli build` — see "Generated assets" below. |
| The built Studio bundle (`dist/connect`) | `pnpm build:connect`, then restart the stack (Connect serves `dist/connect` with no watch). |
| A linked framework package (`clint` / `clint-common`) | Rebuild it in the monorepo, then restart `pnpm dev`. No HMR across a built-dep boundary. |

Both builds may need a larger heap: `NODE_OPTIONS=--max-old-space-size=4096`.
Run them one at a time.

## Generated assets (`dist/skills/`) — the silent-stale gotcha

Agent profiles and `SKILL.md` files are **generated** from
`cli/src/cli.ts` (`prompts.agents`, `prompts.skills`) + `prompts/` into
`dist/skills/skills/<skill>/` and `dist/skills/agent-profiles/`, by
`ph run cli build` (the cli host's `build` verb, the last step of
`pnpm build`; it loads the built `./cli` for its metadata, so it runs
after `ph-cli build`). At runtime `getAgentInstructions(<id>)` reads
`agent-profiles/<name>.md` next to the `prompts.artifacts` directory
(`dist/skills/skills`); a missing file throws and the agent never runs
(e.g. a chat box that types but never replies).

`pnpm dev` reads whatever `dist/skills` the last build left, so a new or
renamed agent or skill has no profile until the next build. Profiles are
read once at agent-definition time, so a restart is required after
`dist/skills` changes.

### Framework source

The framework is `packages/clint` and `packages/clint-common` in the
Powerhouse monorepo (the `.claude/ph-clint` symlink to the old ph-clint
checkout is gone). Read framework internals there. Edit it only for a
cross-repo change, in a separate commit in that repo.

## Authoring vetra agent skills

When editing anything under `prompts/skills-tpl/<skill>/`, use the
`vetra-skill-authoring` Claude skill — it covers sources vs generated
output, what the runtime `skill` tool actually returns, and the preamble
rules that decide whether the model drills into references.

## Ground rules (from `HANDOFF.md`, repeated here so they're loaded)
- Use terse comments.
- No historical narration in code comments ("was previously…", "used
  to…", "swap from X to Y…"). Comments describe the code now.
- Don't pre-emptively wrap up. End-of-turn summaries are 1–2 sentences.
- Commits follow concern, not size. Don't lump cross-repo changes.
