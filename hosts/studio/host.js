// @ts-check
// Vetra Studio: `ph run studio` starts the switchboard and Connect, each in
// its own process, then runs the Cli on this terminal.

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "studio",
  runner: {
    module: "@powerhousedao/host-core/runners/compound",
    // The built Studio: switchboard and Connect in production mode.
    // `ph run studio dev` serves the sources instead (Vite), for work on Studio.
    defaultVerb: "serve",
  },
  // Order from the tokens: switchboard, then connect. The cli member runs the
  // cli runner (a foreground runner): last, in this process, on the terminal.
  children: {
    switchboard: { host: "switchboard" },
    connect: { host: "connect" },
    cli: { host: "cli" },
  },
});
