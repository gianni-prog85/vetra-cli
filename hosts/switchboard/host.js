// @ts-check
// Vetra Studio's switchboard: the Studio drive and the models Studio writes.
// It imports nothing, so it reads the same as a host this package supplies
// (`@powerhousedao/vetra-cli/switchboard`).

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "switchboard",

  runner: {
    module: "@powerhousedao/ph-cli/runners/switchboard",
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
