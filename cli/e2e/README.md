# vetra e2e (Playwright)

Three specs against the Studio stack (`hosts/studio`): the switchboard, Connect
and the Cli, booted once per run by `ph-cli run studio` in a temp dir.

- **`studio-boot.spec.ts`** — the stack is up: Connect serves the Studio drive and
  the page shows the empty Studio's idea screen ("What do you want to build?").
- **`studio-chat.spec.ts`** — the chat round trip (fixture `chat-spec`, the
  default): the idea starts the build; the replay writes a document-model spec
  with `spec-create` and `spec-update`; the story shows the agent's done text;
  the spec is in the Studio drive with spec-update's state (`findDocuments(search:
  { type, parentId })` on `<baseUrl>/graphql`); then a file is sent into the
  build's conversation and the Cli logs `extracted 1 attachment(s)` and writes it
  to `<workdir>/.ph/vetra/downloads/`. The build page's message box takes text only, so the
  spec sends the file as the chat box does: reserve and upload through Connect's
  origin (`/attachments`), then `ADD_USER_MESSAGE` with a `FILE` part naming the
  `attachment://v1:<sha256>` ref (GraphQL `execute`).
- **`studio-build.spec.ts`** — seeded (fixture `todo-list`): drives the idea
  screen to build a todo-list and asserts the generated editor renders inside the
  BUILD-pane iframe (chat → agent → tools → reactor → studio). It waits for the
  project's preview on the Cli's local API (`GET
  http://127.0.0.1:5180/resolve?project=<p>&home=1` = `ready`). Its first step,
  `reactor-project-init`, runs `ph init` against the npm registry at this
  package's version, so it needs those versions published; expect it red until
  then.

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
- `mastra_workspace_write_file` steps are plain file writes under the workdir.
  `chat-spec` uses two to stand in for `reactor-project-init` (which installs
  from npm): a `recipe-box/powerhouse.config.json` and an empty
  `recipe-box/node_modules/`, which is all the spec commands ask of a project.
- An empty Studio starts one product, and both `studio-chat` and `studio-build`
  start one from the idea screen: one of them per boot. Each skips itself under
  the other's fixture.

Isolated from the unit suite: lives under `cli/e2e/`, which vitest does not collect.

## Run

From the package root, after `pnpm build` and `pnpm build:connect` (the stack serves
`dist/`):

```sh
pnpm test:e2e:install      # one-time: chromium, with PLAYWRIGHT_SKIP_BROWSER_GC=1
pnpm test:e2e studio-boot  # boots the stack, opens the Studio, stops the stack
pnpm test:e2e              # boot + chat (chat-spec); the build spec skips itself
VETRA_FIXTURE=todo-list pnpm test:e2e studio-boot studio-build
pnpm test:e2e:report       # open the HTML report after a run
```

Set `PLAYWRIGHT_SKIP_BROWSER_GC=1` on every Playwright command (`test:e2e:install`
sets it itself): without it Playwright deletes the browsers of other Playwright
versions from the shared cache.

`global-setup` spawns `node <ph-cli>/dist/cli.mjs run studio serve -- --workdir
<tmp>/work` from the package root (no shell, stdin a pipe), waits for the Cli's
`Vetra Studio: <url>` line, and writes `.cache/run.json` (`baseUrl`, `driveId`, the
stack's `pid`, the member pids, `tmp`). `global-teardown` runs `ph-cli run studio
--stop` under the same data dir, waits up to 30 s for those pids, kills the trees of
any still running as the last resort, copies the logs to `.cache/service-logs/` and
removes the temp dir.

### Isolation

- **Own data dir.** `PH_USER_DATA_DIR=<tmp>`: the stores, run records
  (`<tmp>/.ph/run`) and member logs (`<tmp>/.ph/services`) stay in the temp dir, so
  the run neither sees nor stops a Studio of this checkout's own `.ph`.
- **Own home.** `HOME` and `USERPROFILE` are `<tmp>/home`: the Cli's service state
  (`homedir()/.ph/vetra`) never touches your real `~/.ph`.
- **Stops with the runner.** The stack runs with `PH_STOP_ON_STDIN=1` and the runner
  holds its stdin: if the runner dies, the pipe closes and the stack stops itself.
- **Ports.** The hosts ask for 8090 (Connect) and 8091 (switchboard); a taken port
  moves to the next free one, and the test reads the real URL from the boot log.
  The Cli's preview server binds `127.0.0.1:5180`.

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
PORTLE_AUTOSTART=0 VETRA_REPLAY_FIXTURE=$PWD/cli/e2e/fixtures/chat-spec.replay.json \
  pnpm exec ph-cli run studio -- --workdir <dir> 2>&1 | tee <dir>.log
# in another shell, with the drive id from its "Vetra Studio:" line:
PLAYWRIGHT_SKIP_BROWSER_GC=1 VETRA_E2E_BASE_URL=http://127.0.0.1:8090 \
  VETRA_E2E_DRIVE_ID=<id> VETRA_E2E_WORKDIR=<dir> VETRA_E2E_LOG=<dir>.log \
  pnpm test:e2e studio-chat
```

### Fixtures

- `<name>.json` — the assertion fixture: the kickoff `prompt`, the `replay`
  filename, and what its spec asserts: `preview` (studio-build: project, document
  name, items with completed state) or `spec` and `attachment` (studio-chat: the
  spec document the replay writes, the file sent afterwards).
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

## CI

`.github/workflows/e2e.yml` runs one job on pull requests that touch the package:
install, `pnpm build`, `pnpm build:connect`, chromium, `pnpm test:e2e studio-boot`.
On failure it uploads the Playwright report and `.cache/` (boot log, service logs).
