# vetra e2e (Playwright)

Three specs against the package's Studio stack (`hosts/studio`): the
switchboard, Connect and the Cli, booted once per run the way a user runs it:
`ph-cli run @powerhousedao/vetra-cli/studio` in a fixture project in a temp dir.

- **`studio-boot.spec.ts`** — the stack is up: Connect serves the Studio drive and
  the page is the Studio page (the top bar with the fixture project's name and
  version, the Specs and Agent panels, the explorer's four stages), not an idea
  screen; the panels close and open from the bar and Test says why it has no
  Preview (the fixture project has no Connect installed); a Build row opens its placeholder page with the Labs
  screenshot Connect serves; Test opens in a tab of its own; Connect serves
  `studio.config.json` naming the Cli's local API.
- **`studio-chat.spec.ts`** — the chat round trip (fixture `chat-spec`, the
  default): a conversation in the Agent panel ("New session", then a message)
  starts the agent; the replay writes a document-model spec into the Studio
  drive with `spec-create` and `spec-update`; the conversation shows the agent's done
  text; the spec is in the Studio drive with spec-update's state
  (`findDocuments(search: { type, parentId })` on `<baseUrl>/graphql`) and in
  the explorer's tree, and the project has no `specs/` folder; then a file is sent into the
  conversation and the Cli logs `extracted 1 attachment(s)` and writes it to
  `<project>/.ph/vetra/downloads/`. The spec sends the file as the chat box does:
  reserve and upload through Connect's origin (`/attachments`), then
  `ADD_USER_MESSAGE` with a `FILE` part naming the `attachment://v1:<sha256>`
  ref (GraphQL `execute`).
- **`studio-build.spec.ts`** — seeded (fixture `todo-list`): builds a todo-list
  and asserts the generated editor renders inside the BUILD-pane iframe. Skipped:
  its fixture starts with `reactor-project-init`, which a Studio inside a project
  does not have, and the Studio page has no preview pane to show the Preview run
  in.

The agent is made **deterministic** without an API key: a replay `AgentProvider`
(`cli/src/agents/replay-agent.ts`, gated by `VETRA_REPLAY_FIXTURE`) replays a
recorded tool sequence, executing the **real** commands against the live reactor.
Only tool *selection* is canned. What that means for a fixture:

- One fixture per boot: the Cli reads `VETRA_REPLAY_FIXTURE` once, and every
  step is checked against its command's input schema at boot.
- The first message of each conversation runs the whole fixture; the prompt's
  text is ignored, and later messages in that conversation get a fixed "already
  built" reply.
- Arguments are static: a step cannot use an earlier step's output (an id, a
  hash). `attachment-stat`/`-get` need the conversation's id as `documentId`, so
  no step can read the chat file back; the extraction itself reads it through the
  conversation (`documentId`), which is what the chat spec checks.
- `mastra_workspace_write_file` steps are plain file writes under the workdir,
  the fixture project. The spec commands act on it, so no step names a
  project.
- One fixture per boot: `studio-chat` and `studio-build` each skip themselves
  under the other's fixture.

Isolated from the unit suite: lives under `cli/e2e/`, which vitest does not collect.

## Run

From the package root, after `pnpm build` and `pnpm build:connect` (the stack serves
`dist/`):

```sh
pnpm test:e2e:install      # one-time: chromium, with PLAYWRIGHT_SKIP_BROWSER_GC=1
pnpm test:e2e studio-boot  # boots the stack, opens the Studio, stops the stack
pnpm test:e2e              # boot + chat (chat-spec); the build spec skips itself
pnpm test:e2e:report       # open the HTML report after a run
```

Set `PLAYWRIGHT_SKIP_BROWSER_GC=1` on every Playwright command (`test:e2e:install`
sets it itself): without it Playwright deletes the browsers of other Playwright
versions from the shared cache.

`global-setup` makes the fixture project `<tmp>/project`: a `package.json`
(`e2e-project` 0.1.0), a `powerhouse.config.json`, a `.gitignore` with `.ph`, and
junctions `node_modules/@powerhousedao/vetra-cli` (this checkout) and
`node_modules/@powerhousedao/ph-cli` (the ph-cli this checkout uses), as an install
would link them. It spawns the project's ph-cli, `node <ph-cli>/dist/cli.mjs run
@powerhousedao/vetra-cli/studio serve`, with the project as its cwd (no shell,
stdin a pipe): the Cli's workdir is the project. It waits for the Cli's `Vetra
Studio: <url>` line and writes `.cache/run.json` (`baseUrl`, `driveId`, the stack's
`pid`, the member pids from `<project>/.ph/run/@powerhousedao/vetra-cli/`, `tmp`).
`global-teardown` runs `ph-cli run @powerhousedao/vetra-cli/studio --stop` in the
project, waits up to 30 s for those pids, kills the trees of any still running as
the last resort, copies the logs to `.cache/service-logs/`, removes the junctions and
then the temp dir.

### Isolation

- **Own project.** The fixture project is the data dir (`PH_USER_DATA_DIR=<tmp>/project`,
  as a user's run has it): the stores, `.ph/vetra/` (the Studio's files), run
  records (`.ph/run/@powerhousedao/vetra-cli/`) and member logs
  (`.ph/services/@powerhousedao/vetra-cli/`) stay in the temp dir, so the run
  neither sees nor stops a Studio of this checkout's own `.ph`.
- **Own home.** `HOME` and `USERPROFILE` are `<tmp>/home`: the Cli's service state
  (`homedir()/.ph/vetra`) never touches your real `~/.ph`.
- **Stops with the runner.** The stack runs with `PH_STOP_ON_STDIN=1` and the runner
  holds its stdin: if the runner dies, the pipe closes and the stack stops itself.
- **Ports.** The hosts ask for 8090 (Connect) and 8091 (switchboard); a taken port
  moves to the next free one, and the test reads the real URL from the boot log.
  The Cli's preview server binds `127.0.0.1` on an OS port, which
  `<baseUrl>/studio.config.json` names.

## Configure

| Env | Default | Meaning |
| --- | --- | --- |
| `VETRA_FIXTURE` | `chat-spec` | Fixture under `cli/e2e/fixtures/` (`<name>.json` + `<name>.replay.json`) |
| `VETRA_E2E_BASE_URL` | _(unset)_ | Attach to a studio you started yourself (already in replay mode); skips boot |
| `VETRA_E2E_DRIVE_ID` | _(unset)_ | With `VETRA_E2E_BASE_URL`: the drive id. Required: Connect does not redirect `/` to the drive |
| `VETRA_E2E_WORKDIR`, `VETRA_E2E_LOG` | _(unset)_ | Attached: the Cli's workdir and a file with its output, for the chat spec's extraction check (skipped without them) and the replay fail-fast |
| `VETRA_BASE_URL` + `VETRA_DRIVE_ID` | _(unset)_ | Point the test at a known studio without `.cache/run.json` |
| `VETRA_E2E_KEEP_WORKDIR` | _(unset)_ | Keep the temp dir after teardown |

Attached to your own stack, start it with the fixture and capture its output:

```sh
# in a project that links this package (node_modules/@powerhousedao/vetra-cli):
PORTLE_AUTOSTART=0 VETRA_REPLAY_FIXTURE=<vetra-cli>/cli/e2e/fixtures/chat-spec.replay.json \
  pnpm exec ph-cli run @powerhousedao/vetra-cli/studio 2>&1 | tee <log>
# in another shell, with the drive id from its "Vetra Studio:" line:
PLAYWRIGHT_SKIP_BROWSER_GC=1 VETRA_E2E_BASE_URL=http://127.0.0.1:8090 \
  VETRA_E2E_DRIVE_ID=<id> VETRA_E2E_WORKDIR=<project> VETRA_E2E_LOG=<log> \
  pnpm test:e2e studio-chat
```

### Fixtures

- `<name>.json` — the assertion fixture: the kickoff `prompt` (the
  conversation's first message), the `replay` filename, and what its spec
  asserts: `preview` (studio-build: project, document name, items with completed
  state) or `spec` and `attachment` (studio-chat: the spec document the replay
  writes, the file sent afterwards).
- `<name>.replay.json` — the ordered tool steps the replay agent executes. Generate
  it from a recorded session log:

  ```sh
  node cli/e2e/fixtures/build-replay-fixture.mjs <path-to>/VetraAgent/<session>.md
  ```

  It keeps the build-affecting calls (drops reads/skills and any call whose recorded
  result errored), in order, with full inputs.

The bundled assertions (`New todo…` placeholder, `Add` button, `<li>` checkboxes) are
specific to the todo-list editor; a different build needs both fixture files **and**
matching assertions in the spec.

## Fail-fast

When a replay step errors, the agent stops and logs `[replay] … ERROR` to
`.cache/studio.log`; `studio-build.spec.ts` and `studio-chat.spec.ts` tail that
file while they wait and throw on the first error line, so a broken build fails in
seconds rather than waiting out the timeout.

## Preview check of a real project (on request)

`preview-editors/` is a suite of its own, not part of `pnpm test:e2e`. It
starts the Studio in an installed project that has this package (the
project's own `ph-cli run @powerhousedao/vetra-cli/studio serve`), waits for
the Preview run, and checks that the Test panel shows the Preview Connect
and that each document type of the project's own packages gets a document
created on the Preview drive through that Connect, with its editor rendered
(no "No editor available" or error screen, not empty). The documents stay
in the project's `.ph/vetra/preview/` stores.

```sh
VETRA_PREVIEW_PROJECT=<project path> pnpm run test:e2e:preview
```

- `VETRA_PREVIEW_TYPES` — document types, comma separated (default: all of
  the project's own).
- `VETRA_PREVIEW_SHOTS`, `VETRA_PREVIEW_SHOT_PREFIX` — where the page
  screenshots go (default `test-results/preview-editors/`): one per type,
  `test-panel-1600.png`, and `preview-editors.json` with each result.
- `VETRA_E2E_STUDIO_URL` — the `Vetra Studio:` address of a Studio already
  running in that project: attach, and leave it running.

Ports 8090 to 8093 must be free (the suite refuses to start otherwise). It
stops what it started with `serve --stop`; the stack's output is in
`.cache/preview-editors-studio.log`.

## CI

`.github/workflows/e2e.yml` runs one job on pull requests that touch the package:
install, `pnpm build`, `pnpm build:connect`, chromium, `pnpm test:e2e studio-boot`.
On failure it uploads the Playwright report and `.cache/` (boot log, service logs).
