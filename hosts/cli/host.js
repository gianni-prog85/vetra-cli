// @ts-check
// The vetra Cli (this package's ./cli), attached to the Studio switchboard.
// The studio compound's foreground member; `ph run cli build` compiles the
// skills and agent profiles.

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "cli",
  // This package's own ./cli (no config.package).
  runner: { module: "@powerhousedao/clint/cli-runner" },
  // The Studio switchboard's drive. The Cli finds the Studio drive by name.
  reactor: {
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
  },
});
