# Architecture: vetra

This document describes how `vetra` is put together — the components
that run in-process, the services it spawns, and the preview pipeline
that lets a freshly-generated document model be rendered live in a
browser editor as the agent iterates.

For in-progress work and setup steps, see `HANDOFF.md`. This file is
the durable map of how the pieces fit; that file is the working state
of the open work.

## High-level component map

```
                  ┌────────────────────────────────────────────────┐
                  │           vetra process (the Cli)              │
                  │                                                │
                  │  ┌─────────────────┐                           │
   user ────────► │  │ Interactive REPL│                           │
   (terminal)     │  │  (clint)        │                           │
                  │  └────────┬────────┘                           │
                  │           │                                    │
                  │  ┌────────▼────────┐    ┌──────────────────┐   │
                  │  │ Mastra agent    │◄──►│ Reactor client   │   │
                  │  │ (`createAgent`) │    │ (remote attach)  │   │
                  │  └────────┬────────┘    └────────┬─────────┘   │
                  │           │                      │             │
                  │  ┌────────▼─────────────────┐    │             │
                  │  │ vetra local API          │    │             │
                  │  │ HTTP + SSE on 127.0.0.1  │    │             │
                  │  │ :5180 — resolve/start/   │    │             │
                  │  │ events (+ future surface)│    │             │
                  │  └──────────────────────────┘    │             │
                  └──────────────────────────────────┼─────────────┘
                                                     │ GraphQL
                  ┌──────────────────────────────────▼─────────────┐
                  │ Switchboard (its own host): GraphQL + MCP      │
                  │ drive address <switchboard>/d/<slug>           │
                  └────────┬───────────────────────────────────────┘
                           │
                ┌──────────┴──────────────┐
                │                         │
                ▼                         ▼
       ┌──────────────────┐  ┌─────────────────────┐
       │ Connect          │  │ reactor-project(s)  │
       │ (static SPA      │  │ per-chat-session    │
       │ serving this     │  │ ph run vetra dev:   │
       │ package's        │  │ Switchboard +       │
       │ editors)         │  │ Connect with Vite   │
       │ Drive editor =   │  │ HMR. Preview docs   │
       │ Vetra Studio     │  │ live here.          │
       └────────┬─────────┘  └─────────────────────┘
                │                       ▲
                │  iframe deep-linked   │
                └───────────────────────┘
```

The package is one Powerhouse package, `@powerhousedao/vetra-cli`: document
models and editors in the standard folders, the Cli in `cli/`, exported as
`./cli` (`cli/index.ts`, built by `ph build` to `dist/node/cli/index.mjs`).
The Cli runs three ways, all through clint's Cli runner (`runCli`):

- a host: `ph run studio` (the compound in `hosts/studio`, see "Hosts")
  starts the Studio switchboard and Connect, then loads `./cli` and hands it
  the switchboard's drive address;
- the `vetra` bin (`bin/vetra.mjs`) over the built `./cli`;
- `pnpm dev` (`tsx cli/src/main.ts --workdir ../vetra-test`) from source.

The bin and `pnpm dev` read the drive address from `VETRA_SWITCHBOARD_URL`
(`<switchboard>/d/<slug>`). Without one, commands that need no reactor still
run, and anything that asks for the reactor fails with the message in
`configureReactor.create`. Agent conversation logs live under
`<workdir>/.ph/vetra/logs/<agent>/`.

Internally:

- The **agent**, the **reactor client** and the **vetra local API** run
  inside the vetra node process. The documents live on the switchboard.
- The **routine** runs registered **triggers** on a poll loop in the
  same process (`chatSessionWatchTrigger`, spec-sync triggers).
- The **switchboard** and **Connect** (serving this package's Studio) are
  hosts of their own (B2). **reactor-project** sessions run as child
  processes managed by clint's service manager: previews, one per active
  build, spawned on demand by the agent.

## Repositories

- `vetra-cli` — this repo. CLI definition, agents, services, triggers,
  tool implementations, the local API server, and the document models,
  editors, processors and subgraphs of the Studio (package root).
- The Powerhouse monorepo — framework and stack: `packages/clint` (Cli,
  runners, reactor attach, service manager, routine loop, REPL, agent
  loader), `packages/clint-common` (chat-session model and triggers),
  `apps/switchboard`, `apps/connect`, `packages/reactor`,
  `packages/reactor-browser`. Linked locally with
  `workspace/local-link/link.sh`; published versions come from the
  `pnpm-workspace.yaml` catalog.

## Hosts

Five host files under `hosts/` (shipped in the package, `files`). Each
host's `name` is its folder name: `ph run <host> --stop` finds the run
record by the word typed. None imports `outputs.js` or
`powerhouse.config.json`; cross-host values are literal `$output` tokens, so
the files read the same when the package supplies them to another project.
A host may import a sibling host file (`connect` and `studio-signed` do).

| Host | Runner | What it is |
|---|---|---|
| `switchboard` | `@powerhousedao/ph-cli/runners/switchboard` | The Studio switchboard: port 8091 on `127.0.0.1`, plugins `mcp` and `attachments`, `auth` off, `createSignaturePolicy: "legacy"` (a local Studio's Cli attaches without a signer). Declares one drive: slug `studio`, name `Home`, `powerhouse/document-drive`, `preferredEditor: vetra-studio` |
| `connect` | `@powerhousedao/ph-cli/runners/connect` | The Studio SPA: port 8090, `outDir: dist/connect` (`build` writes it, `serve` serves it), branding and Renown namespace. A remote client of the switchboard (no reactor in the tab); its server proxies the switchboard's paths (`runner.proxy` = the switchboard's `origin`), so the browser talks to 8090 only |
| `cli` | `@powerhousedao/clint/cli-runner` | This package's `./cli`, with one remote backend on the switchboard's `drives.studio.url`. `ph run cli build` compiles skills and agent profiles |
| `studio` | `@powerhousedao/host-core/runners/compound` | `switchboard`, `connect`, `cli`; default verb `serve` (the built Studio). The tokens order the start: switchboard, then Connect, each in its own process; the Cli last, in the compound's process, on the terminal. Its end ends the stack |
| `studio-signed` | `@powerhousedao/host-core/runners/compound` | The same three members for a local check of signing: the `switchboard` and `connect` members restate their hosts' `reactor` with `createSignaturePolicy: "v2-required"` (a member's `reactor` replaces the host's whole section; only `runner` key-merges), and the switchboard's stores move to `${userData}/.ph/vetra-signed/{reactor-storage,read-storage}`, so legacy and v2 documents never share a store. Auth stays off. Not run by anything; see "The signed check" |

The drive slug is `studio`, not `vetra` or `vetra-*`: loading
`@powerhousedao/vetra` registers its codegen processor, which attaches to
those. The Cli finds the drive by its name, `Home` (clint's `ensureDrive`),
so the switchboard must declare that name or the Cli creates a second drive.

`ph run studio -- --workdir <dir>` passes `--workdir` to the Cli; without it
the Cli works in the project root. `ph run studio dev` runs the members at
`dev` (the Cli still at `run`, from the built `./cli`).

Ports: 8090 Connect (the Studio's address), 8091 the switchboard, 5180 the
vetra local API, 8092-8093 kept free for a preview run. Neither runner sets
`strictPort`, so a taken port moves to the next free one and the outputs
carry the real one.

Stores: `${userData}/.ph/vetra/reactor-storage` and
`${userData}/.ph/vetra/read-storage` (PGlite). `${userData}` is
`PH_USER_DATA_DIR`, else the project root. Under the same `.ph` tree: the
run records `.ph/run/{studio,switchboard,connect}.json` and the member logs
`.ph/services/{switchboard,connect}/`.

The switchboard loads this package (from `dist/node` at `serve`, through
the Vite loader at `dev`) and the packages of the project's
`powerhouse.config.json` (clint-common and `@powerhousedao/vetra`, both
local). The config names no `packageRegistryUrl`, so nothing is fetched
from a registry. `@powerhousedao/vetra-cloud-package` stays a dependency
but is no Studio package: its processors and subgraphs belong to the cloud
switchboard, and the Studio's Deploy view imports its document models
through `cloud-client/`. From another project
(`ph run @powerhousedao/vetra-cli/studio`) that and Connect's `outDir` are
read against the project, not the package: not supported yet.

`hosts/tsconfig.json` type-checks the host files (`tsc -p hosts`, part of
`pnpm typecheck`); `hosts/types.d.ts`, the two `outputs.js`/`outputs.d.ts`
and `powerhouse.config.d.json.ts` are written by `ph-cli generate hosts`.
The `@satisfies {PHHost}` tag sits on the exported expression: in front of
`export default` TypeScript ignores it.

### The signed check (`hosts/studio-signed`, by hand)

What a person runs to see a signed Studio on this machine (design B3,
acceptance A10). It needs a wallet that can sign in on Renown; no `ph login`
is needed: a switchboard without a keypair generates one at
`${userData}/.ph/.keypair.json` and signs with it. It cannot run next to a
`studio` stack (same ports, and the members' run records
`.ph/run/{switchboard,connect}.json` share names).

1. Build once: `pnpm build`, then `pnpm build:connect`. Ports 8090, 8091
   and 5180 free.
2. Start it from this package's root (Git Bash); keep the data dir apart
   from the workdir, so the switchboard's keypair and the agent's
   (`<workdir>/.ph/vetra/agent/.keypair.json`) stay two identities:

   ```sh
   export PH_USER_DATA_DIR=<fresh data dir>
   export PORTLE_AUTOSTART=0
   export VETRA_ENVIRONMENT_ID=local-signed-check   # any value: the Cli signs as the agent
   export ADMINS=<your wallet address>              # the only wallet the agent may act for
   export VETRA_SESSION_EXPORT_SECRET=<long random string>
   # optional, a chat without an LLM key:
   export VETRA_REPLAY_FIXTURE=$PWD/cli/e2e/fixtures/chat-spec.replay.json
   pnpm exec ph-cli run studio-signed -- --workdir <fresh workdir>
   ```

   Expect `Switchboard identity initialized: did:key:…` and no `No signer is
   configured` warning in `$PH_USER_DATA_DIR/.ph/services/switchboard/*.log`,
   and no `[signing]` error from the Cli. With an environment id the cloud
   triggers (product requests, live health) also run and log their failures
   against the made-up id.
3. Authorize the agent before the first message. The tab's "Authorize
   agent" gets 401: with an environment id the local API takes no loopback
   pass, and the tab sends no bearer, because nothing writes
   `studio.config.json`. The operator secret passes the gate instead:

   ```sh
   S=$VETRA_SESSION_EXPORT_SECRET
   curl -s -X POST -H "Authorization: Bearer $S" http://127.0.0.1:5180/auth/start
   # open pending.loginUrl from the answer, approve with the ADMINS wallet
   curl -s -X POST -H "Authorization: Bearer $S" "http://127.0.0.1:5180/auth/confirm?wait=60000"
   # {"authenticated":true,"address":"0x…"}; "not-owner": that wallet is not in ADMINS
   ```

4. Open the printed `Vetra Studio: http://127.0.0.1:8090/d/<id>` and sign in
   with Renown in the tab (the account menu) with the same wallet before
   Build it: the tab creates the product and the conversation, and a
   `v2-required` document refuses an unsigned create. On `127.0.0.1` the tab
   does not ask for the sign-in itself.
5. Send the idea. Expect the agent's answer, then every operation the agent
   wrote carrying its key: find the conversation with
   `findDocuments(search: { type: "powerhouse/chat-session", parentId: "<id>" })`,
   then on `http://127.0.0.1:8090/graphql`:

   ```graphql
   { document(idOrSlug: "<session id>") { document { operations { items {
       index action { type context { signer { user { address } app { key } signatures } } } } } } } }
   ```

   The agent's operations name your address and the agent's `did:key` (its
   keypair under `<workdir>/.ph/vetra/agent/`), each with a signature.
6. Stop: `pnpm exec ph-cli run studio-signed --stop`.

## Components, in detail

### Reactor (remote attach)

`cli.configureReactor` in `cli/src/cli.ts` declares `remote` as a function
clint's runner calls with the setup context at attach: the document models
(this package's six, `@powerhousedao/vetra`'s and clint-common's), the drive
`Home` (`preferredEditor: vetra-studio`, found by name; the switchboard host
declares it) and the subscriptions, plus, in a cloud Studio, the agent's
identity. The runner attaches with clint's `attachDefaultReactor`: a
`GraphQLReactorClient` on the switchboard, `personalDriveId` = the `Home`
drive, no `_module`. `create` only throws: vetra builds no in-process
reactor.

The Home drive holds: chat session documents, spec documents
(mirrored from the reactor-project filesystems by the spec-sync
triggers), and any other domain content the studio surfaces.

**Signing.** A cloud Studio (`VETRA_ENVIRONMENT_ID` or
`config.environmentId`; `isCloudStudio` in `cli/src/auth/studio-mode.ts`)
attaches with the agent's Renown identity (`cli/src/auth/studio-identity.ts`):
`signer` = the workdir's Renown signer, `tokenProvider` = its bearer while it
has a user, `onSignerChange` = Renown's `user` event, `legacyDocuments:
"refuse"`. clint hands them to its writes, emits `powerhouse:writes:ready`
when the owner authorizes the agent, and reconnects the realtime socket with
the new bearer. A local Studio passes none: no keypair is written at start,
and writes go out unsigned. While the signer has no user every write is
refused, a legacy one included (clint documents this limit), so a signer goes
only to a cloud Studio, whose switchboard creates `v2-required` documents.

The signature mode of the spec writes is the switchboard's create policy
(`studioSignatureMode`: `client.getCreateSignaturePolicy()`, read once per
client). The Cli plans no mode, writes no marker and creates no drive: the
Studio drive is host data in both modes. A cloud Studio on a `legacy`
switchboard, or a local one on a `v2-required` switchboard, logs one
`[signing]` error at start and runs on.

### Switchboard

Not started by the Cli. The switchboard is its own host,
`hosts/switchboard` (see "Hosts": the Studio drive, its slug and preferred
editor are host data); the Cli reaches it over GraphQL at the drive address
the runner hands over. The Cli runs no proxy of its own.

### Connect (Vetra Studio)

Static SPA built from this package (`dist/connect/`), served by its own
host, `hosts/connect` (the former `build:connect` flags are its `runner`
and `config`). See "Build-output split" below for how that directory is
produced.

**Build-output split — two independent commands.** The package ships
two artifact families and they are built separately:

- `pnpm build` (the ph-version writer, `ph-cli build`, then
  `ph-cli run cli build`) emits `dist/{browser,node,types}` — the
  package's consumable exports, `./cli` included — and the skills and
  agent profiles in `dist/skills/{skills,agent-profiles}`.
- `pnpm build:connect` (`ph-cli connect build`, i.e. `ph run connect
  build` over `hosts/connect`) builds the package again, then the SPA
  bundle Connect serves into `dist/connect` (`runner.outDir`), with the
  host's branding, favicon and Renown namespace. The bundle freezes a
  snapshot of `powerhouse.manifest.json` and the local editor modules at
  build time.

`pnpm build` does **not** rebuild `dist/connect/`, and leaves it and
`dist/skills` in place. Editing `editors/*`, `powerhouse.manifest.json`,
or anything the SPA loads requires running both commands and restarting
Connect (it serves `dist/connect` with no watch). A common failure mode:
the source manifest lists the new app under `apps[]` but the bundled SPA
still carries the empty pre-edit manifest, so Connect falls back to
`GenericDriveExplorer` and the new drive editor never shows up.

**The drive URL.** Connect's server merges the host's config over the
baked `powerhouse.config.json` per request (`serve`): the Studio drive
and the remote backend come from the switchboard's outputs, written as
`${origin}/d/studio` because Connect proxies the switchboard. Nothing is
stamped into `dist/connect` for it, and no `studio.config.json` is written:
the SPA falls back to `127.0.0.1:5180` for the local API.

The user's landing experience — `Vetra Studio` — is a custom **drive
editor** registered against `powerhouse/document-drive` and selected
via the vetra drive's `preferredEditor` field. The editor renders:

- Left rail: list of chat session documents in the drive, plus a
  "What will you build today?" entry point that creates a new session.
- Right pane: the **active workflow scaffold** for the current chat
  session. Default scaffold renders four vertical step cards
  (`ideate`, `specify`, `build`, `deploy`). The BUILD card hosts an
  iframe deep-linked into the chat session's current reactor-project
  Connect.

### vetra local API

HTTP + SSE service hosted inside the vetra node process on a fixed
loopback port. Default `127.0.0.1:5180`; see
`cli/src/preview-server/config.ts` for the constant. The Studio SPA calls
it directly. The loopback bind is not relied on as the access control: a
deployment may put a proxy in front, so every route that isn't needed to
render a preview is owner-gated per request (see "Preview-server access
gate" below). CORS is `*`: the gate is a bearer header, never an ambient
cookie.

Implemented as a trigger (`cli/src/triggers/preview-server.ts`)
so it gets the framework's `ServiceManager` + event-bus access via
`TriggerContext`. Server module lives at `cli/src/preview-server/`.

**Endpoints (current):**

- `GET /resolve?project=<label>&doc=<id-or-slug>` — read-only. Returns
  the live preview URL or a state code (`no-target`,
  `unknown-project`, `project-stopped`, `preview-off` (the project run is
  off, see "reactor-project service"), `starting`, `ready`). The
  editor calls this on every relevant state change.
- `GET /project-package?project=<label>` — read-only. Returns the
  project's package identity (`{ kind: "ok", name, version }`) read from
  `<workdir>/<label>/package.json`, or `unknown-project` / `no-package`.
  The Deploy section's read-only package display calls this.
- `GET /release-status?project=<label>&registry=<url>` — read-only. Compares
  the project's current source content hash
  (`helpers/project-fingerprint.ts`) against the hash embedded in the latest
  published version on the registry (full packument via
  `cloud/registry-packument.ts`), returning `{ kind: "ok", upToDate,
  needsRelease, localVersion, publishedVersion, reason }` or
  `unknown-project` / `no-package` / `unknown`. `reactor-project-publish`
  embeds the hash at `package.json` → `powerhouse.contentHash`. The Deploy
  section's "up to date / needs release" indicator calls this.
- `POST /publish?project=<label>&registry=<url>` — build + publish the
  project's package for the Deploy flow (`preview-server/publish-project.ts`).
  Skips publishing when the source already matches the latest published
  version (same content hash); otherwise picks a free version and runs the
  **same publish sequence the agent's `reactor-project-publish` uses** —
  `publishReactorProject` in `commands/reactor-project/publish-core.ts` (embed
  content hash, `reactor-project/build.ts`, `npm publish --registry` with a
  token minted from the agent's Renown identity). The shared core bump-and-
  retries a registry version conflict (`bumpOnConflict`) so a stale packument
  can't surface a 409 to the UI. Returns `{ kind: "ok", packageName, version,
  registry, published }` (`published: false` = skipped, install the existing
  version) or `unknown-project` / `no-package` / `auth-required` / `failed`.
  The browser then installs that exact version into the target cloud
  environment (env-document edit + approve, signed by the user). This is the
  publish half of the Deploy section's per-environment Deploy/Update action.
- `POST /start?project=<label>` — idempotent. If an instance for
  the project's workdir is already `starting`/`ready`, returns
  `already-running`; otherwise spawns one via
  `services.start("reactor-project", ...)` and returns `started`.
  The editor calls this automatically when `/resolve` returns
  `project-stopped` — preview intent implies project should run.
- `GET /events` — SSE stream of `service:*` events filtered to
  `id === "reactor-project"`. The editor refetches `/resolve` on
  any event. 15s heartbeat keeps the stream alive through quiet
  periods.
- `GET /sessions` — gated. Lists the Studio drive's chat-session
  documents (`{ id, name, status, startedAt, threadId, agent }`):
  `client.find({ type, parentId: <drive> })`, the drive's `child`
  documents, every page. `503 reactor-unavailable` when no reactor is
  attached.
- `GET /sessions/export?id=<session>` — gated. Returns a zip
  (`application/zip`, attachment) bundling the session for debugging:
  `chat-session.json` (the reactor doc state), `chat-session-operations.json`
  (op history), `mastra-thread.json` (the Mastra thread `recall`ed by the
  doc's `threadId`, when the LibSQL store exists), `session.md` (the
  markdown log when `agentLogging` was on), and `metadata.json` (versions,
  model, flags, which sources were found). `404 unknown-session`,
  `503 reactor-unavailable`. Implementation: `preview-server/session-export.ts`.
- `GET /export?workspace=1` — gated. Streams a zip (`application/zip`,
  attachment `vetra-workspace.zip`) of the whole workdir under a `workspace/`
  prefix, excluding `node_modules`, build/cache output
  (`dist`/`build`/`.next`/`out`/`coverage`/`.turbo`/`.cache`), `.git`, the `.ph`
  store, and `.env*` secrets. Deflate runs on fflate's worker pool and
  the archive streams to the response (bounded memory; the main thread stays
  free). Single-flight: a concurrent request gets `409 export in progress`. A
  general endpoint — `workspace` is the only selectable part today. `400` when
  no part is selected. Implementation: `preview-server/workspace-export.ts`.
- `GET /export/status` — public; returns `{ authorized }`: whether *this
  caller* passes the owner gate. The studio "Download workspace" button reads
  it to send a signed-out user to Renown sign-in instead of failing the fetch.
- `GET /auth/status`, `POST /auth/start|confirm|logout` — owner-only; the
  agent's Renown identity (studio "Authorize agent" / publish permission).
- `GET /healthz` — liveness check.

**Preview-server access gate** (`preview-server/request-auth.ts`,
`createRequestAuthorizer`). Public routes: `/healthz`, `/version`,
`/resolve` (no absolute `projectPath`, no raw error text), `/events` (event
types only — failure text is not forwarded) and `/export/status`. Every other route (`/project-package`, `/release-status`,
`/publish`, `/start`, `/restart`, `/sessions*`, `/export`, `/auth/*`) is
owner-only and checks **the request**, never the daemon's own Renown
sign-in. It passes when the request carries:

1. the operator secret `VETRA_SESSION_EXPORT_SECRET` as
   `Authorization: Bearer <secret>` or `?token=` (sha256 + timingSafeEqual) —
   the support path; or
2. the signed-in user's Renown bearer, minted by the studio client **for this
   Studio only**: `aud` = the Studio's origin, read per request from the
   ready Connect member's `endpoints.connect` (`studioUrlOf`; the client
   would take it from `previewServerUrl` in `studio.config.json`, which
   nothing writes now, so the client sends no bearer and a cloud Studio's
   owner routes are refused until per-project config, C1). The gate requires that exact `aud` — a token with
   no `aud` (e.g. one minted for the switchboard, which refuses `aud`
   tokens) or another Studio's `aud` fails, so a token a malicious Studio
   captures can't be replayed here. The binding is to the **origin**
   (scheme + host + port), not the path: each Studio must be served from
   its own origin (true for cloud Studios, one subdomain each); two Studios
   under one origin with different base paths would accept each other's
   tokens. The client reuses one token until shortly before its 10-minute
   expiry rather than minting per call. Then `verifyAuthBearerToken` (signature +
   expiry), the claimed wallet must be in the pod's `ADMINS`, and
   `verifyAuthCredential` confirms on Renown that the wallet delegated to the
   token's app key (a self-signed token claiming the owner's address fails
   here). Bearers are verified on the Renown the Studio's Connect logs in on
   (`resolveStudioRenownUrl`). Delegation verdicts are cached per
   (app key, wallet) — what the lookup proves — for 5 min ok / 30 s refused,
   with concurrent checks sharing one lookup. A key verified in the last 24 h
   re-verifies without any cap, so the owner's polling never hits one and a
   flood of fresh attacker keys can't lock the owner's key out; keys not yet
   verified are capped at 3 lookups/min each and 30/min overall. A non-owner
   wallet never costs a lookup. Residual: a flood of fresh keys can delay an
   owner's *first* verification on a new device by up to a minute; or
3. local mode only — no studio environment id (`VETRA_ENVIRONMENT_ID`), no
   `ADMINS`, no secret: a request from a loopback socket whose every
   `x-forwarded-for` hop is loopback (a proxy in front appends the real
   client address, so its LAN clients are refused), whose `Host`
   and `x-forwarded-host` are loopback, and whose `Origin`, if any, is
   loopback (blocks cross-site pages / DNS rebinding).

A cloud Studio never takes path 3, and with `ADMINS` unset (or no known
public origin) refuses every bearer (fail closed). Every refusal is the same
`401 {error:"unauthorized"}` — no oracle for which wallet is the owner. The
studio client (`editors/vetra-studio/.../hooks/preview-server-client.ts`) mints the
bearer from the Connect Renown session (`window.ph.renown`, `aud` = Studio
origin) on every owner-only call, and sends none while `studio.config.json`
hasn't loaded (the `127.0.0.1` fallback).

`POST /auth/confirm` in a cloud Studio keeps a completed agent login only when
its wallet is in `ADMINS`; any other wallet is logged straight back out
(`error: "not-owner"`), so the agent can't be switched to another identity.
The same rule applies whenever the agent's identity is read (`auth/renown.ts`
`getRenown`/`getAuthState`/`getBearerToken`/`getSigner`, …): a stored
non-owner credential (e.g. from before the rule) is cleared and the agent
reads as signed out.

Residual risks: (a) the owner's Renown session lives in Connect's origin; if
the owner signs into Renown on an attacker's page (a malicious Studio or
app), that page gets its own delegated app key for the owner's wallet and can
mint `aud`-bound tokens for any Studio — `aud` binding stops replay of
captured tokens, not a delegation the owner granted. Revoking the delegation
on Renown is the remedy. (b) Local mode behind a proxy relies on
`x-forwarded-host` for the browser's real `Host`; a proxy that keeps a
client-sent `x-forwarded-host` lets a DNS-rebinding page set
`X-Forwarded-Host: localhost` itself. Sub-agent threads (resource `cli-user-<agentName>`) are not bundled in
session exports — their per-delegation threadIds don't link back to a
session.

**Endpoints (planned but not yet built):**

- `GET /projects` / `GET /projects/subscribe` — broader projection
  of the service manager's reactor-project state, beyond the
  per-target resolution `/resolve` provides today.
- `GET /chat-sessions/:id/workflows` /
  `GET /chat-sessions/:id/workflows/subscribe` — workflow registry
  projection. Depends on the workflow registry itself, which is
  unbuilt.

The API surfaces two kinds of state:

- **Project runtime state** — projection of the service manager.
  Source of truth remains clint's service state,
  `~/.ph/vetra/services/reactor-project/<instance>.json` (instances
  keyed by a hash of the project path); the API is a fanout. `/resolve`
  is a per-target slice; the planned `/projects` endpoints would
  expose the full list.
- **Workflow registry state (planned)** — in-memory map of workflow
  instances per chat session. Not implemented yet.

The API exists for **cross-session, ephemeral runtime state** that the
editor needs to see live but that doesn't belong in CRDT-replicated
documents. The line is intentional (see "State transport" below).

The writes (`POST /start`) are scoped: only thing the editor can
trigger is starting a reactor-project that a session already pointed
at. It can't enumerate, stop, or otherwise mutate the manager.

### State transport: chat-session document vs local API

Two parallel channels carry state from the agent / runtime to the
browser-side editor. Each has a clearly-scoped purpose.

- **Chat-session document (reactor)** carries domain content and
  within-session UI signals: user/agent messages, tool calls, tool
  results, workflow dispatch events. Replicated, persistent,
  scrollable history. Read via standard reactor-browser
  subscriptions. The editor's "show this preview" signal is just the
  most recent relevant tool call in the session's history.

- **vetra local API (HTTP + SSE)** carries ephemeral runtime
  state that lives across or outside agent turns: project lifecycle,
  workflow live state (especially when V2 background tasks need to
  update state without an agent turn happening). Not persisted, not
  replicated; recomputed on each vetra boot.

The distinction is deliberate. Ephemeral runtime state in a CRDT
document creates noise in history and forces the editor to constantly
re-derive "current" from a log. Domain content in HTTP+SSE loses
replayability and forces re-fetching on every reload. Putting each
class where it belongs keeps both subsystems simple.

### Drive editor (Vetra Studio)

A custom editor registered for `powerhouse/document-drive`. Lives at
`editors/vetra-studio/`. The vetra drive's
document sets `preferredEditor` to this editor's id so Connect picks
it up automatically.

Composition:

- Subscribes via `useDocument` to the drive doc itself (to list chat
  sessions) and to the currently-selected chat session (for messages,
  tool calls, and stage content derived from tool history).
- Subscribes via `fetch` + `EventSource` to the vetra local API
  for project and workflow live state.
- Renders the active workflow scaffold (default = four-step vertical
  layout) in the right pane. Scaffold component reads tool-call
  history from the chat session to populate step cards; reads project
  state from the local API to resolve iframe URLs.

### reactor-project service

The project's own `ph run vetra dev` (`services/reactor-project.ts`, a
clint host service): the compound the 6.4 scaffold writes to
`hosts/vetra`, its `vetra-switchboard` and `vetra-studio` members each in
their own process, Vite HMR for editors.

**Opt-in.** The run opens the project's own stores (on Sektar: its
business drives, workflows and Portle), so it is off unless the Cli config
says `projectRun: true` (env `VETRA_PROJECT_RUN=1`). While off, the
service's first preflight refuses every start (agent, BUILD pane, restart),
the agent sees no `reactor-project-start` or `-restart` in any phase
(`PROJECT_RUN_TOOLS` in `agents/phase-tools.ts`), and `/resolve` answers
`preview-off` where it would say `project-stopped`, so the BUILD pane shows
"Preview comes with the Preview run" and starts nothing. A scaffolded
project can turn it on; C2's Preview host replaces it.

When on, it is spawned by the agent via the
`reactor-project-start` tool or the BUILD pane's `POST /start`, in the
project folder (a subfolder of the workdir), with the project as its data
dir: its stores and `.ph/run/vetra.json` are the project's own. Ready once
that record is live; stopped through its stdin (the compound shuts its
members down; its tree is killed only after 30 s). Ports are the
project's host data. A project without `hosts/vetra/host.js` cannot
preview (until C2 supplies a Preview host).

The service's endpoints come from the record (`previewEndpoints`):
`vetra-studio` = the Connect member's `endpoints.connect`,
`vetra-switchboard` = the switchboard member's `endpoints.graphql`,
`mcp-server`, `vetra-drive-url`, and the **preview drive** (declared slug
`vetra-preview`, a project-hashed id) as `vetra-preview-drive-url` and
`vetra-preview-drive-id`. Preview documents (instances of in-progress
document models) live in this drive. The agent's `spec-preview-*` tools
target it by default. The editor composes iframe URLs as deep links into
this drive's editor route.

A chat session may associate with a reactor-project throughout its
lifecycle, and may also switch projects mid-session if the agent
needs to touch multiple projects. The chat-session document carries
a reference to its current project (id or workdir path); switching
is an explicit action.

### Agent

Created via `cli.configureAgent(createAgent)`. Mastra-backed.

Tool surface for MVP (see `HANDOFF.md` for the implementation
checklist):

- **Existing project lifecycle:** `reactor-project-init`,
  `reactor-project-start`, `reactor-project-stop`, `reactor-project-ls`.
- **Existing spec lifecycle:** `spec-create`, `spec-get`, `spec-list`,
  `spec-update`, `spec-delete`, `spec-extract`, `spec-generate`.
- **Preview document lifecycle (planned):** `spec-preview-create`,
  `spec-preview-get`, `spec-preview-list`, `spec-preview-update`,
  `spec-preview-delete`. Mirror the `spec-*` shape; operate on the
  preview drive of a named reactor-project.
- **Workflow tools (planned):** `start_workflow({ scaffold, input? })`,
  `set_step_content({ instanceId, step, payload })`,
  `complete_step({ instanceId, step })`,
  `promote_workflow({ instanceId })`,
  `complete_workflow({ instanceId, status })`.

Workflow scaffolds are React components in `editors/vetra-studio/`. The default
scaffold's step ids are `'ideate' | 'specify' | 'build' | 'deploy'`.
BUILD step payload shape: `{ projectId, documentId, title? }`. The
scaffold resolves the iframe URL from the editor's project-state
subscription; the agent does not construct Connect URLs.

### Renown identity (agent authorization)

**Renown is the identity/auth provider.** The user authorizes the agent with
their Renown identity once; that authorization lets the agent act as the user
across Vetra Cloud and other Renown-protected services. The `deploy-environment-*`
tools are one consumer — they operate on the user's real Vetra Cloud environments
at `switchboard.staging.vetra.io` (the same switchboard the Studio's
Deploy section uses). The Node side lives in `cli/src/cloud/`.

Two Renown identities are involved: the user's wallet identity (browser, on
`renown.id`) and the agent's own `did:key` (backend). Authorizing the agent
delegates the user's wallet to that `did:key`.

- **Identity.** `@renown/sdk/node` `RenownBuilder` gives the agent a stable
  `did:key`. The keypair persists to `<workdir>/.ph/vetra/agent/.keypair.json` and the
  delegated credential to `<workdir>/.ph/vetra/agent/.renown.json` (workdir-scoped,
  apart from the project's own `ph login` pair at `.ph/` root); `PH_RENOWN_PRIVATE_KEY` overrides the keypair
  for pre-provisioned deployed agents. `src/auth/renown.ts` caches one
  `IRenown` per workdir and exposes `getBearerToken` (no `aud` — the
  switchboard's verifier rejects it), `getSigner`, the auth state machine
  (`startAuth` / `getAuthState` / `confirmAuth` / `logoutAuth`), and
  `getRenownStatus`. (The Vetra Cloud resource layer — switchboard URL,
  environments, drive — stays under `src/cloud/`.)
- **Authorization is the user's action, from the studio.** The agent has a
  single read-only `whoami` tool (reports whether it's authorized, and as
  which address); it cannot log in. The studio header renders an **Authorize
  agent** button (`editors/vetra-studio/.../AgentAuthButton.tsx`, left of "Auto-follow
  agent") that drives the console flow via the preview-server (the in-process
  local API, sharing the same per-workdir `IRenown`): `POST /auth/start`
  builds the `<renownUrl>/console?session=…&connect=<agentDid>` URL and opens
  it; the user approves with their wallet on `renown.id`; `POST /auth/confirm`
  polls `<renownUrl>/api/console/session/<id>` and runs `renown.login` to store
  the credential; `GET /auth/status` and `POST /auth/logout` round it out. (An
  in-app one-click authorize isn't possible — the wallet session and credential
  publishing live on the
  `renown.id` origin.) The Renown server URL defaults to
  `https://www.renown.id` (`config.cloudRenownUrl` overrides); the switchboard
  URL defaults to staging (`config.cloudSwitchboardUrl`).
- **Publish path (live).** `reactor-project-publish` mints a registry-bound
  bearer token from the agent's identity (`getRegistryToken` in
  `src/auth/renown.ts` → `generateAccessToken(…, { aud: registryUrl })`, the
  same mechanism as `ph publish`) and passes it to `npm publish` as the
  ephemeral `_authToken`; `reactor-project-publish-status` reads the registry
  packument over HTTP with the same token. No `npm login` — authorizing the
  agent is the only prerequisite.
- **Read path (live).** `deploy-environment-list` / `-get` query
  `myEnvironments` over GraphQL with the bearer token
  (`src/cloud/graphql.ts`) and trim to the caller's own environments
  (`filterOwn`, mirroring the Studio).
- **Write path (live).** `deploy-environment-create` / `-update` load (or
  create) the `vetra-cloud-environment` document via a `RemoteDocumentController`
  and push signer-signed actions against the cloud, mirroring the Studio
  (`src/cloud/environments-write.ts`, delegating to
  `cloud-client/`).
- **Wait.** `deploy-environment-wait` polls the read path every 5s (up to a
  caller-set timeout — default 30s, max 60s) until the status leaves the
  in-flight set (`CHANGES_*` / `DEPLOYING` / `TERMINATING`) and settles, so the
  agent blocks in a single tool call instead of looping `deploy-environment-get`
  (`src/commands/deploy/wait.ts`).

### Triggers

Registered in `cli.ts`. Run as part of clint's routine loop.

- `chatSessionWatchTrigger` (clint-common) — watches chat-session
  documents for new user messages and forwards them to the agent.
- `specSyncTrigger` — drive → filesystem mirror for spec documents.
  Routes each doc to `<workdir>/<project>/specs/` by reading the doc's
  file node and its parent folder (the project) off the Home
  drive; falls back to `<workdir>/specs/` for root-level
  docs (single-project layout).
- `specFsSyncTrigger` — filesystem → drive (chokidar-based), the
  **external-change detector**: hand-edited `.phd`, `git pull`,
  reactor-project writes. Watches the workdir root recursively, so
  `specs/` subtrees for projects created after startup are picked up
  automatically (no `poll()` reconcile step). For each `.phd` it
  materializes a document the switchboard lacks (empty, the file's id
  and type), executes the content actions whose ids the switchboard does
  not hold (`client.execute`, one call per scope; there is no load API
  over the wire), and attaches the doc to the Home drive under an
  ADD_FOLDER node named after its project with an ADD_FILE node and a
  `child` relationship (idempotent ensure-folder + ensure-file). This is
  the project↔folder mapping `specSyncTrigger` reads back. The shared
  push/remove logic lives in `helpers/spec-drive-sync.ts`
  (`applyFsChangesToReactor`, `removeSpecFromDrive`, one sync at a time
  per process); the `spec-*` write commands call it directly (see
  below), so for command-originated changes this watcher only observes a
  convergent no-op. The switchboard's store persists, so a spec deleted
  while the Cli was down stays in the drive.

The `spec-*` write commands (`spec-create`, `spec-update`,
`spec-extract`, `spec-delete`) write the filesystem `specs/`
unconditionally — codegen's source of truth — and, when a reactor is
already running, **also push the change into the Home drive
synchronously** via the same `spec-drive-sync.ts` helpers. The
running-reactor signal is `helpers/embedded-drive.ts` →
`getEmbeddedDrive(ctx)`: it gates on `ctx.folders` (wired once the
reactor is attached with a personal drive, absent in one-shot CLI) so a standalone
`vetra spec-create` never attaches just to write a spec. When
present, `ctx.reactor()` returns the attached reactor. Lookups by type
in the drive (the product document, chat sessions) use
`findInDrive` there: `client.find({ type, parentId })` over every page.
- `previewServerTrigger` — runs the local API server. Triggers
  receive `commandContext.services` + `commandContext.on`, which is
  exactly what the http handlers need. `setup()` boots the server,
  `teardown()` closes it on daemon shutdown, `poll()` returns null
  (no work items — the trigger is purely a lifetime host for the
  server).

### Services

- `reactor-project` — the project's `ph run vetra dev` for the preview
  surface (see "reactor-project service"). Persistent state at
  `~/.ph/vetra/services/reactor-project/<instance>.json` (clint's user
  store; read by `reactor-project-ps` and projected over the local API); the
  run's own record is `<project>/.ph/run/vetra.json`.

## Boot sequence

`ph run studio` first starts the switchboard (its run record waits for the
seeded `studio` drive), then Connect, each in its own process, then the
Cli in the compound's process (the foreground member) at `run`, handed the
drive URL
(`<switchboard>/d/studio`) and the two members as service instances. The
stack's record is `.ph/run/studio.json`. Then clint's start sequence, run by
the Cli runner (`runCli`):

1. **Reactor** — with a drive address, the runner's `RunOptions.reactor`
   attaches to the switchboard (`attachDefaultReactor` with
   `configureReactor.remote`): the GraphQL client, the `Home` drive found
   by name or created, the subscriptions bridged. No embedded switchboard,
   Connect or reactor store starts. Without an address, `create` throws as
   soon as something asks for the reactor.
2. **Routine** — trigger loop starts. `previewServerTrigger.setup()`
   binds the local API HTTP + SSE server on `127.0.0.1:5180` and
   subscribes to the framework event-bus for `service:*` events.
   The other triggers (`chatSessionWatchTrigger`,
   `specSyncTrigger`, `specFsSyncTrigger`) begin polling.
   `studioUrlTrigger` prints `Vetra Studio: <url>/d/<drive id>` (non-TTY)
   or opens it in the browser: `<url>` is the ready Connect member's
   `endpoints.connect` (`http://127.0.0.1:8090/`). Connect does not
   redirect `/` to the drive: open the printed `/d/<id>` URL.

The stack ends when the Cli ends, on Ctrl-C, or on
`ph run studio --stop`, which stops the members in reverse order.

`reactor-project` instances stay dormant until the agent starts one
via the `reactor-project-start` tool.

### Auto-start of reactor-project

Only with the project run on (`projectRun`; off, `/resolve` says
`preview-off` and nothing starts). The editor pre-empts manual lifecycle
calls for the BUILD pane. When
`/resolve` returns `project-stopped` for a session's target, the
browser-side `useResolvedPreview` hook fires `POST /start` once per
target without any user click. SSE drives the resulting state
transitions back into the pane: `service:starting` →
`service:ready` → the pane refetches `/resolve` and lands on `ready`.

Guards: the browser tracks "auto-started for project X" to avoid
spinning on a persistent failure (e.g. port conflict surfaces as
`service:failed`; the guard is only cleared when state reaches
`ready`, so the next stop will auto-recover). The server side is
idempotent independently: a `POST /start` for an already-running
workdir returns `already-running` and never spawns a duplicate.

The agent's existing `reactor-project-start` tool is still the
chat-visible way to start a project; auto-start is the recovery
path. Agent-driven starts produce visible chat history, which is
preferable for normal flow.

## Preview flow

What happens when the agent previews an in-progress document model.

```
  agent
    │
    ▼
  spec-create / spec-update
    ├─→ specs/*.phd  (filesystem, codegen source of truth)
    │       │ also feeds reactor-project tree (project source)
    │       ↓ (ph run vetra dev, Vite HMR)
    │   reactor-project picks up new document model (codegen)
    └─→ Studio drive  (direct, synchronous when the reactor is attached;
                          specFsSyncTrigger is the fallback for
                          external edits)
    │
    ▼
  spec-preview-create({ projectId, specSlug })
    → reactor-project Switchboard GraphQL mutation
    → returns { documentId, driveId }
    │
    ▼
  set_step_content({ instanceId, step: 'build',
                     payload: { projectId, documentId, title } })
    → recorded in chat session as a tool call
    │
    ▼
  Drive editor scaffold's BUILD card observes the tool call,
  reads the reactor-project's Connect URL from local API state,
  sets <iframe src> to a deep link into the preview drive
    │
    ▼
  User watches the editor render live as the agent iterates;
  Vite HMR re-renders on each codegen pass.
```

The chain has no package boundary: specs are generated directly into
the reactor-project's source tree, the dev-mode Switchboard registers
the document model from the project's own code, the dev-mode Connect
imports the editor via Vite. No `npm publish`, no local registry, no
dynamic bundle swap.

## Browser addresses

The Cli runs no proxy. What the browser reaches, all on this machine:

- **The Studio** — Connect on 8090, which proxies the Studio switchboard's
  paths (see "Hosts"). Connect does not redirect `/`; the Cli prints
  `<connect>/d/<drive id>`.
- **The local API** — `http://127.0.0.1:5180` directly (the SPA's fallback
  when no `studio.config.json` names another).
- **BUILD iframe** — the project's own Connect at the URL its run record
  gives (`/resolve` `url`, e.g. `http://localhost:3001/d/<preview drive>/<doc>?embed=1`);
  an app drive's `driveUrl` parameter is the project switchboard's
  `/d/<id>` directly.

One public origin (a cloud Studio, or a remote browser) needs a proxy in
front of these: C2/C4 (a Preview host with fixed ports) or Labs.

## Workflow scaffolds

A workflow scaffold is a React component in `editors/vetra-studio/` that owns the
right-pane layout for a class of agent task. Scaffolds:

- Declare the step ids they accept (`'ideate' | 'specify' | 'build' |
  'deploy'` for the default scaffold).
- Define per-step payload shapes.
- Render whatever UI fits the task. The default scaffold is a vertical
  timeline of step cards; future scaffolds can be single full-bleed
  iframes, side-by-side comparisons, etc.

Workflow instances live in vetra's in-memory registry. Each chat
session can have multiple instances; one is `primary` and renders in
the right pane. Non-primary instances surface as a small indicator
(badge / status strip).

The agent dispatches workflows via `start_workflow({ scaffold,
input? })` and mutates them via the other workflow tools. For MVP,
workflows have no engine — they're declarative state that the agent
maintains. V2 will plug Mastra workflow runners into the same
registry without changing the agent or editor surfaces.

## Filesystem layout

```
vetra-cli/                     ← package root, @powerhousedao/vetra-cli
├── ARCHITECTURE.md            ← you are here
├── HANDOFF.md                 ← open work + next steps
├── package.json               ← exports (./cli included), bin `vetra`
├── pnpm-workspace.yaml        ← catalog (the Powerhouse line), overrides
├── powerhouse.manifest.json
├── index.ts                   ← package export: models, editors, processors
├── document-models/
├── editors/
│   └── vetra-studio/          ← drive editor (Vetra Studio)
├── processors/
├── subgraphs/
├── prompts/                   ← agent sections and skill templates
├── cloud-client/              ← Vetra Cloud environment client
├── bin/vetra.mjs              ← the `vetra` bin over dist/node/cli
├── hosts/                     ← switchboard, connect, cli, studio and studio-signed (compounds)
├── cli/
│   ├── index.ts               ← ./cli: startup guards, `cli`, `ensureModelAuth`
│   ├── src/
│   │   ├── main.ts            ← `pnpm dev` entry (runCli)
│   │   ├── cli.ts             ← defineCli + configureReactor (remote)
│   │   ├── framework.ts       ← config + secrets schemas, document registry
│   │   ├── constants.ts       ← default PH version
│   │   ├── agents/agent.ts    ← Mastra agent factory
│   │   ├── preview-server/    ← vetra local API (resolve/start/events)
│   │   ├── commands/          ← spec-*, reactor-project-*, spec-preview-*
│   │   ├── services/
│   │   │   └── reactor-project.ts
│   │   └── triggers/
│   │       ├── preview-server.ts   ← hosts the local API
│   │       ├── spec-sync.ts
│   │       └── spec-fs-sync.ts
│   ├── tests/                 ← vitest project `cli` (the app's tests: `app`)
│   ├── scripts/               ← build-assets.ts (ph-version), dev scripts
│   └── e2e/                   ← playwright suite
└── dist/                      ← ph build output; dist/connect from build:connect

<project>/.ph/vetra/           ← the Studio switchboard's stores
                                 (reactor-storage, read-storage)
<project>/.ph/vetra-signed/    ← the same for hosts/studio-signed
<project>/.ph/run/             ← run records of the studio stack
<workdir>/.ph/vetra/           ← the Cli's own files (helpers/studio-paths.ts):
                                 clint's store (.mastra, logs), the agent's
                                 identity (agent/.keypair.json, .renown.json),
                                 downloads/ (files from chat messages), the
                                 local API's preview-trusted-keys.json,
                                 codegen.lock, launch.json, product-drive.json,
                                 upgrade-existing.json
~/.ph/vetra/services/          ← clint's service state (reactor-project)
```

Nothing the Cli writes on its own account lands at `.ph/` root, where a
project keeps its own `ph login` identity (`.keypair.json`, `.renown.json`).

## Open gaps

These are limitations of the current direction; not bugs.

- **Workflow registry is in-memory.** vetra restart drops all
  active workflows; the editor reconnects to a fresh registry. For
  MVP this is fine. Persistence (and the resumable-vs-abandonable
  question that comes with it) is V2.

- **Project state is not a drive document.** Chat sessions reference
  their current project by a transient handle (path or service
  instance id). Renaming or moving a project workdir invalidates
  references in any chat sessions that pointed at it. Promoting
  project to a document model in the vetra drive is phase 2;
  it'll resolve this and let the editor enumerate projects via the
  reactor instead of a side-channel API.

- **Agent doesn't see runtime failures.** Service errors, workflow
  failures, and reactor-project crashes surface in the terminal via
  log handlers; the agent's input channels (chat session + Mastra
  thread) don't yet receive them. A `pushAgentNotice(message)` primitive
  in clint, or a per-turn pending-context queue, would close it.

- **Studio-mode parity.** Connect runs static (the package's prebuilt
  bundle), served by its own host from B2. The live preview path is
  reactor-project + Vite HMR, not dynamic package loading.

- **The remote path.** A cloud Studio's signing is checked by unit tests
  only: `hosts/studio-signed` runs a `v2-required` switchboard, but its
  check needs a wallet and has not been run (see "The signed check"). Its
  tab cannot authorize the agent: with an environment id the local API
  refuses the tab's owner calls (no loopback pass, no bearer without
  `studio.config.json`, and a bearer's `aud` would have to be the Studio's
  origin, not `127.0.0.1:5180`), until per-project config (C1) names the
  Studio's origin to the tab. `ReactorContext.client` is typed as the full client, so a call
  `GraphQLReactorClient` lacks would fail at run time, not in the type
  check; the Cli, the spec sync and clint's folder operations use only
  calls both clients have. Studios from before the product page are not
  upgraded: a product starts from the idea screen; one whose story starts
  with work from before versions still launches through
  `ensureProductTarget` (`product/upgrade-existing.ts`). The attach carries the switchboard's
  attachment service: the chat watch reads a message's file through its
  conversation (`documentId`), which the switchboard admits by the reference
  it indexes from the message's `AttachmentRef` field
  (`cli/e2e/tests/studio-chat.spec.ts` runs it). The build page's message
  box sends text only; files reach a conversation from the chat-session
  editor or the API.

- **Hosts (B2).** The package's form (`ph run
  @powerhousedao/vetra-cli/studio` from another project) is not supported
  yet: Connect's `outDir` and the switchboard's packages are read against
  the project (see "Hosts"). Connect's `/` shows its own start page,
  not the Studio drive: the printed `/d/<id>` URL is the Studio.

The live publish path — `commands/reactor-project/publish.ts` and
`publish-status.ts` — is unaffected: those are the deploy-flow tools that
publish a Reactor package to the remote registry via the agent's Renown
token (see "Renown identity → Publish path" above).
