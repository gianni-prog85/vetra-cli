// @ts-check
// Vetra Studio: the built Studio SPA, a remote client of the Studio
// switchboard (no reactor in the tab).
import switchboard from "../switchboard/host.js";

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "connect",

  runner: {
    module: "@powerhousedao/ph-cli/runners/connect",
    port: 8090,
    // `build` writes the Studio SPA here; `serve` serves it.
    outDir: "dist/connect",
    // The browser talks to this origin only: Connect's server proxies the
    // switchboard's paths (/graphql, /d/*, /attachments, /mcp, /api/*).
    proxy: {
      target: { $output: { host: "switchboard", path: ["origin"] } },
    },
  },

  config: {
    branding: { appName: "Vetra Studio", favicon: "./branding/vetra.ico" },
    renown: { namespace: "vetra-studio" },
  },

  reactor: {
    protocol: switchboard.reactor.protocol,
    backends: {
      studio: {
        kind: "remote",
        remote: {
          url: {
            $output: { host: "switchboard", path: ["drives", "studio", "url"] },
          },
        },
      },
    },
    drives: [
      {
        slug: "studio",
        remote: {
          url: {
            $output: { host: "switchboard", path: ["drives", "studio", "url"] },
          },
        },
      },
    ],
  },
});
