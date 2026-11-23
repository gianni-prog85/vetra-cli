// @ts-check
// The Preview run: the project's code on a switchboard and a Connect of the
// Studio's own, each in its own process. The Cli starts it in the project
// (`ph run @powerhousedao/vetra-cli/preview`); the project needs no host for it.

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "preview",
  runner: {
    module: "@powerhousedao/host-core/runners/compound",
    // Dev: both members serve the project's sources and reload on a change.
    defaultVerb: "dev",
  },
  // Order from the tokens: the switchboard, then Connect. Named apart from
  // the Studio's members: both compounds run in one project.
  children: {
    "preview-switchboard": { host: "preview-switchboard" },
    "preview-connect": { host: "preview-connect" },
  },
});
