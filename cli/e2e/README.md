# vetra e2e (Playwright)

Two specs against the Studio stack (`hosts/studio`): the switchboard, Connect and
the Cli, booted once per run by `ph-cli run studio` in a temp dir.

- **`studio-boot.spec.ts`** — the stack is up: Connect serves the Studio drive and
  the page shows the empty Studio's idea screen ("What do you want to build?").
- **`studio-build.spec.ts`** — seeded: drives the idea screen to build a todo-list
  and asserts the generated editor renders inside the BUILD-pane iframe (chat →
  agent → tools → reactor → studio). It needs the project run inside the stack,
  which the stack does not have yet; expect it red until then.

The agent is made **deterministic** without an API key: a replay `AgentProvider`
(`cli/src/agents/replay-agent.ts`, gated by `VETRA_REPLAY_FIXTURE`) replays a
recorded tool sequence, executing the **real** commands against the live reactor.
Only tool *selection* is canned.

Isolated from the unit suite: lives under `cli/e2e/`, which vitest does not collect.

## Run

From the package root, after `pnpm build` and `pnpm build:connect` (the stack serves
`dist/`):

```sh
pnpm test:e2e:install      # one-time: chromium, with PLAYWRIGHT_SKIP_BROWSER_GC=1
pnpm test:e2e studio-boot  # boots the stack, opens the Studio, stops the stack
pnpm test:e2e              # both specs
pnpm test:e2e:report       # open the HTML report after a run
```

`test:e2e:install` sets `PLAYWRIGHT_SKIP_BROWSER_GC=1`: without it Playwright
deletes the browsers of other Playwright versions from the shared cache.

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
| `VETRA_FIXTURE` | `todo-list` | Fixture under `cli/e2e/fixtures/` (`<name>.json` + `<name>.replay.json`) |
| `VETRA_E2E_BASE_URL` | _(unset)_ | Attach to a studio you started yourself (already in replay mode); skips boot |
| `VETRA_E2E_DRIVE_ID` | _(unset)_ | With `VETRA_E2E_BASE_URL`: the drive id, instead of following `/` → `/d/<id>` |
| `VETRA_BASE_URL` + `VETRA_DRIVE_ID` | _(unset)_ | Point the test at a known studio without `.cache/run.json` |
| `VETRA_E2E_KEEP_WORKDIR` | _(unset)_ | Keep the temp dir after teardown |

### Fixtures

- `<name>.json` — the assertion fixture: the kickoff `prompt`, the `replay` filename,
  and the expected `preview` (project, document name, items with completed state).
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
`.cache/studio.log`; `studio-build.spec.ts` tails that file while waiting for the
preview and throws on the first error line, so a broken build fails in seconds rather
than waiting out the preview timeout.

## CI

`.github/workflows/e2e.yml` runs one job on pull requests that touch the package:
install, `pnpm build`, `pnpm build:connect`, chromium, `pnpm test:e2e studio-boot`.
On failure it uploads the Playwright report and `.cache/` (boot log, service logs).
