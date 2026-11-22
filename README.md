# Vetra CLI

**Build Powerhouse document-model apps and packages by chatting with an agent.**



---

Vetra is an **agent-driven CLI** for the [Powerhouse](https://www.powerhouse.inc/)
tech stack. Instead of hand-scaffolding boilerplate, you describe what you want
in plain language and the agent designs and generates it for you — then renders
it live in a browser editor (**Vetra Studio**) as you iterate.

You can build:

- **Document models** — state schemas, operations, and reducers.
- **Editors** — React components for editing a document type.
- **Drive-apps** — dashboards, kanban boards, and custom drive-level views.
- **Reactor packages** — initialize, build, and publish the whole thing.

## How it works

```
   you (terminal)
        │  "build a to-do document model"
        ▼
  ┌─────────────────┐      ┌──────────────────────┐
  │  Vetra agent    │◄────►│ Studio Switchboard   │
  │  (the Cli)      │      │ (:8091, drive Home)  │
  └────────┬────────┘      └──────────┬───────────┘
           │ spawns + previews        │ proxied
           ▼                          ▼
  ┌──────────────────────────────────────────────┐
  │ Vetra Studio (Connect)                       │
  │ live preview → http://127.0.0.1:8090/d/...   │
  └──────────────────────────────────────────────┘
```

`ph run studio` starts the Studio as a stack of hosts (`hosts/`): a
Switchboard that holds the Studio drive, **Vetra Studio** — a Connect-based
browser editor in front of it — and the agent's interactive Cli attached to
the drive, so a freshly generated document model renders live while you
iterate. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full map.

The orchestrator (`vetra-agent`) delegates to three specialists —
`agent-document-model`, `agent-editor`, and `agent-app` — each backed by skills
that run in `expert`, `discovery`, or `one-shot` mode depending on how much you
want the agent to decide on its own.

## Prerequisites

- **Node** ≥ 24
- **pnpm** 11 — optional; the installer uses it if present and otherwise offers
  to install it (via npm), falling back to npm if you decline
- An **Anthropic API key** (the agent runs on
Claude)
- **Docker** — only needed for the end-to-end [lab](lab/README.md)

## Run it locally

Clone the repo, install, build, and start the Studio:

```sh
pnpm install
pnpm build
pnpm build:connect
pnpm exec ph-cli run studio -- --workdir ../vetra-test
```

> **`ph run studio` is the local entrypoint.** It starts the Studio
> switchboard (port 8091) and Connect (8090), then the agent's Cli in the
> terminal; `--workdir` is where the agent works (default: this
> repository). Open the printed `Vetra Studio: http://127.0.0.1:8090/d/<driveId>`
> to see your work live. Stop it with Ctrl+C or
> `pnpm exec ph-cli run studio --stop`. Stores live in `.ph/vetra/`.
>
> `pnpm dev` runs the Cli from source instead (`tsx cli/src/main.ts`, no
> build step), against a running switchboard:
> `VETRA_SWITCHBOARD_URL=http://localhost:8091/d/studio pnpm dev`.
>
> Until the 6.4 release is on npm, the monorepo packages install linked
> (`workspace/local-link/link.sh`).

Authenticate the agent once, either way:

```sh
# API key
export ANTHROPIC_API_KEY=sk-ant-...
```

To wipe the local dev workspace and start clean:

```sh
pnpm dev:reset
```

## Your first session

Type your idea in the Studio page, or open the Cli's shell in the terminal
(`pnpm exec ph-cli run studio -- -i --workdir ../vetra-test`). Once the REPL is
up you'll see:

```
vetra v0.0.1 …
Workdir: …
Type a message to talk to the agent, or / for commands.
```

Try a build, end to end:

```
> Create a "todo-list" document model with tasks that have a title,
  a done flag, and a priority. Then generate an editor for it.
```

The agent designs the schema, generates the model and editor, and boots Vetra
Studio. Open the printed `http://127.0.0.1:8090/d/<driveId>` URL and edit your
new document type in the browser. Iterate by continuing the conversation.

Type `/` at any time to see the available slash commands (publishing, service
control, auth, and more).

## Installing the published CLI

The released CLI ships as the `vetra` binary. Install it with the one-liner —
it installs `ph-cmd` + `vetra` globally. Claude auth is set up on the first
`vetra` launch, not by the installer:

```sh
curl -fsSL https://get.vetra.io | sh
```

Prefer to run it yourself (to read it first)?

```sh
curl -fsSL https://get.vetra.io -o install.sh
sh install.sh
```

Advanced / manual install — the CLI needs both packages:

```sh
# vetra lives on the pre-release registry until it ships to npmjs.
npm install -g ph-cmd vetra --registry=https://registry.vetra.io # or: pnpm add -g ...
vetra                                    # launch the agent REPL
```

`ph init` scaffolds new projects with pnpm when it's installed, else npm (set
`VETRA_PACKAGE_MANAGER` to force `npm`/`pnpm`/`yarn`/`bun`).

Installer env knobs (non-exhaustive — see the header of `install.sh`):
`VETRA_VERSION`, `PH_VERSION`, `VETRA_REGISTRY` (registry for the `vetra`
package; defaults to the pre-release registry `https://registry.vetra.io`),
`VETRA_PM=npm|pnpm` (installer PM),
`VETRA_PACKAGE_MANAGER` (PM for scaffolded projects), `VETRA_SKIP_PH=1`,
`VETRA_YES=1` (non-interactive), `VETRA_NO_LAUNCH=1`.

## Project layout


The repository is one package, `@powerhousedao/vetra-cli`.

| Path                               | What it is                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| [cli/](cli/)                       | The CLI — agent definitions, services, triggers, and the local API; `cli/index.ts` is the `./cli` export. |
| [bin/vetra.mjs](bin/vetra.mjs)     | The `vetra` bin: runs the built `./cli`.                                          |
| [prompts/](prompts/)               | Agent profile and skill sources.                                                  |
| [cloud-client/](cloud-client/)     | The Vetra Cloud environment client.                                               |
| `document-models/`, `editors/`, `processors/`, `subgraphs/` | The Powerhouse package — document models, editors, processors, subgraphs. |
| [lab/](lab/)                       | Docker-based e2e reproduction of the publish → build → run pipeline.              |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Durable map of how the runtime fits together.                                     |
| [CLAUDE.md](CLAUDE.md)             | Agent/contributor instructions and dev-daemon gotchas.                            |


## Publishing

`pnpm build` writes the Powerhouse version marker and runs `ph-cli build`
into `dist/`; the package publishes with `npm publish`. The `ph-publish`
scripts are gone.

## Troubleshooting

- **"I fixed it but nothing changed."** The Studio's Connect serves the
built `dist/connect` and its switchboard the built `dist/node`, with no
watch. Rebuild (`pnpm build`, `pnpm build:connect`) and restart the stack:
`ph-cli run studio --stop`, then `ph-cli run studio`. Don't `pkill` the
processes: `--stop` stops the members in order.
- **Ports (8090 / 8091).** Connect (the Studio's address) is 8090, its
switchboard 8091. A taken port moves to the next free one; the Cli prints the
address it got (`Vetra Studio: <url>`). The vetra local API takes an OS port;
`<studio>/studio.config.json` names it (`previewServerUrl`).
- **The BUILD pane says "Preview comes with the Preview run".** The project
run is off by default: Studio starts no stack of the project's own (it would
open the project's stores). Turn it on for a scaffolded project with
`VETRA_PROJECT_RUN=1` (config `projectRun: true`). The preview is then the
project's own `ph run vetra dev` (its Connect on 3001 and switchboard on 4001
unless the project's hosts say otherwise). It needs the project's
`hosts/vetra/host.js`, which `ph init` on Powerhouse 6.4 scaffolds; its run
record is `<project>/.ph/run/vetra.json`.
- **A build runs out of memory.** `pnpm build` and `pnpm build:connect` may
need `NODE_OPTIONS=--max-old-space-size=4096`. Run them one at a time.
- **Agent types but never replies / a profile is missing.** Agent profiles and
skills are generated into `dist/skills` by `pnpm build` (its last step,
`ph-cli run cli build`); `pnpm dev` reads what the last build left there.

More detail on the dev-daemon model and reload story lives in
[CLAUDE.md](CLAUDE.md).

## Contributing

The codebase ships three durable docs that carry project state across sessions:
[ARCHITECTURE.md](ARCHITECTURE.md) (how it fits together), [HANDOFF.md](HANDOFF.md)
(in-progress publish/dynamic-load work), and [TODO.md](TODO.md) (backlog). Read
them before non-trivial changes. To validate the full publish/build/run pipeline
without touching production, use the [lab](lab/README.md):

```sh
./lab/ci/run-prodclose-e2e.sh
```

## Learn more

- [Powerhouse](https://www.powerhouse.inc/) — the broader platform
- [Vetra Academy](https://academy.vetra.io/) - Vetra documentation 
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime internals

## License

[AGPL-3.0](LICENSE). If you run a modified version of Vetra as a network
service, the AGPL requires you to make your modified source available to its
users.

