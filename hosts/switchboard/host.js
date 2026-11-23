// @ts-check
// Vetra Studio's switchboard: the Studio drive and the models Studio writes.
// It imports nothing, so it reads the same as a host this package supplies
// (`@powerhousedao/vetra-cli/switchboard`). `${package}` is this package's
// root in both forms (here, the repository root), so the switchboard serves
// this package's models, never the project's, and keeps its identity under
// the Studio's own folder.

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "switchboard",

  runner: {
    module: "@powerhousedao/ph-cli/runners/switchboard",
    // Not strict: taken (a Studio of another project), the next free port;
    // the run record names the real one, and every reader takes it from there.
    port: 8091,
    // A declared composition: MCP for agents, attachments for chat files.
    // No workflows.
    plugins: [
      "@powerhousedao/switchboard/plugins/mcp",
      "@powerhousedao/switchboard/plugins/attachments",
    ],
  },

  config: {
    switchboard: {
      // Loopback only, and no sign-in until signing comes (B3). Set here so a
      // project's powerhouse.config.json `auth` does not reach this switchboard.
      server: { host: "127.0.0.1" },
      auth: { enabled: false },
      // The package's own (empty) config file, not the project's
      // powerhouse.config.json: no project packages, no registry.
      configFile: "${package}/hosts/switchboard/config.json",
      // This package and the two it serves, found from the package; the
      // project (the working directory) is not loaded.
      packages: {
        disableLocal: true,
        list: [
          "${package}",
          "@powerhousedao/clint-common",
          "@powerhousedao/vetra",
        ],
      },
      // Its own keypair and Renown user, apart from the project's
      // `.ph/.keypair.json` and `.ph/.renown.json`.
      identity: {
        keypairPath: "${userData}/.ph/vetra/switchboard/.keypair.json",
        storagePath: "${userData}/.ph/vetra/switchboard/.renown.json",
      },
    },
  },

  reactor: {
    // Unsigned writes until B3: the Cli attaches without a signer.
    protocol: { createSignaturePolicy: "legacy" },
    backends: {
      main: {
        kind: "in-process",
        storage: {
          kind: "path",
          dataDir: "${userData}/.ph/vetra/reactor-storage",
        },
        readModel: { url: "${userData}/.ph/vetra/read-storage" },
      },
    },
    drives: [
      // Not `vetra` or `vetra-*`: @powerhousedao/vetra's codegen processor
      // attaches to those. The Cli finds this drive by its name.
      { slug: "studio", name: "Home", preferredEditor: "vetra-studio" },
    ],
  },
});
