/**
 * Proxy path prefix for a reactor-project's Connect (the BUILD-pane iframe
 * target). Must equal `/{serviceId}/{captureName}` of the `vetra-studio`
 * capture in `services/reactor-project.ts` — ph-clint derives the proxy
 * route from those names. The service passes it to `ph vetra --base` so the
 * Vite dev server emits all URLs under this prefix, making the SPA
 * self-contained behind the proxy.
 */
export const REACTOR_PROJECT_CONNECT_PROXY_PATH = "/reactor-project/vetra-studio";

/**
 * Proxy path prefix for a reactor-project's Switchboard. Routes registered by
 * `reactor-project-start` mirror the embedded `/switchboard/*` scheme
 * (`/d/`-aligned shape so X-Forwarded-Prefix lets the switchboard announce
 * proxied follow-up endpoints), and `ph vetra --drives-public-base` points
 * the nested studio's drive URLs here when a public proxy URL is configured.
 */
export const REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH = "/reactor-project/switchboard";

/**
 * Powerhouse stack version new reactor projects are initialized with.
 * Generated from the `catalog:` entry in pnpm-workspace.yaml at build time
 * (see scripts/build-assets.ts) so it tracks the version vetra's runtime
 * is built against.
 */
export { DEFAULT_PH_VERSION } from './ph-version.gen.js';
