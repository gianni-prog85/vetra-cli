// @ts-check
// The Preview switchboard: the project's own code (the working directory) in
// dev mode, on stores of its own under the Studio's folder. It loads the
// project's document models, processors and subgraphs from source and reloads
// them on a change; the inspector reports what is loaded. The project's
// business stores, config file and identity are not touched.

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "preview-switchboard",

  runner: {
    module: "@powerhousedao/ph-cli/runners/switchboard",
    // Not strict: taken, the next free port; the run record names the real one.
    port: 8093,
    // No workflows. The project is the only package loaded (no `packages`
    // list): no Vetra model or processor, so nothing here writes code.
    plugins: [
      "@powerhousedao/switchboard/plugins/mcp",
      "@powerhousedao/switchboard/plugins/attachments",
      {
        module: "@powerhousedao/switchboard/plugins/inspector",
        config: {
          reportFile: "${userData}/.ph/vetra/preview/inspector.json",
        },
      },
    ],
  },

  config: {
    switchboard: {
      // Loopback only and no sign-in. Set here so a project's
      // powerhouse.config.json `auth` does not reach this switchboard.
      server: { host: "127.0.0.1" },
      auth: { enabled: false },
      // The package's own (empty) config file, not the project's
      // powerhouse.config.json: no registry download into the project. The
      // project itself is loaded as the local package.
      configFile: "${package}/hosts/switchboard/config.json",
      // Its own keypair and Renown user, apart from the project's and the
      // Studio switchboard's.
      identity: {
        keypairPath: "${userData}/.ph/vetra/preview/switchboard/.keypair.json",
        storagePath: "${userData}/.ph/vetra/preview/switchboard/.renown.json",
      },
    },
  },

  reactor: {
    protocol: { createSignaturePolicy: "legacy" },
    backends: {
      main: {
        kind: "in-process",
        storage: {
          kind: "path",
          dataDir: "${userData}/.ph/vetra/preview/reactor-storage",
        },
        readModel: { url: "${userData}/.ph/vetra/preview/read-storage" },
      },
    },
    drives: [{ slug: "preview", name: "Vetra Preview" }],
  },
});
