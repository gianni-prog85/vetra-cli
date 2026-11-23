// @ts-check
// The Preview Connect: generic Connect in dev mode over the project (the
// working directory), so the project's editors load from source. A remote
// client of the Preview switchboard, opened on the Preview drive.
import switchboard from "../preview-switchboard/host.js";

/** @type {{ $output: { host: string, path: string[] } }} */
const previewDriveUrl = {
  $output: {
    host: "preview-switchboard",
    path: ["drives", "preview", "url"],
  },
};

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "preview-connect",

  runner: {
    module: "@powerhousedao/ph-cli/runners/connect",
    // Not strict: taken, the next free port; the run record names the real one.
    port: 8092,
    // The browser talks to this origin only: Connect's server proxies the
    // switchboard's paths.
    proxy: {
      target: { $output: { host: "preview-switchboard", path: ["origin"] } },
    },
  },

  config: {
    // A first visit's cookie dialog would cover the Preview.
    app: { cookieBanner: false },
    renown: { namespace: "vetra-preview" },
  },

  reactor: {
    protocol: switchboard.reactor.protocol,
    backends: {
      preview: { kind: "remote", remote: { url: previewDriveUrl } },
    },
    drives: [{ slug: "preview", remote: { url: previewDriveUrl } }],
  },
});
