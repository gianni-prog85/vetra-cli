// @ts-check
// Vetra Studio, signed: the studio compound on a switchboard that creates
// v2-required documents, with its own stores so legacy and v2 documents
// never share one. The Cli signs as the agent when an environment id is set
// (VETRA_ENVIRONMENT_ID); without it its writes are refused. A local check
// only: auth stays off. See ARCHITECTURE.md, "Hosts".
import connect from "../connect/host.js";
import switchboard from "../switchboard/host.js";

/** @type {{ createSignaturePolicy: "v2-required" }} */
const protocol = { createSignaturePolicy: "v2-required" };

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "studio-signed",
  runner: {
    module: "@powerhousedao/host-core/runners/compound",
    defaultVerb: "serve",
  },
  // A member's `reactor` replaces the host's whole section (only `runner`
  // key-merges), so each restates its host's reactor with the change.
  children: {
    switchboard: {
      host: "switchboard",
      reactor: {
        ...switchboard.reactor,
        protocol,
        backends: {
          main: {
            kind: "in-process",
            storage: {
              kind: "path",
              dataDir: "${userData}/.ph/vetra-signed/reactor-storage",
            },
            readModel: { url: "${userData}/.ph/vetra-signed/read-storage" },
          },
        },
      },
    },
    connect: {
      host: "connect",
      reactor: { ...connect.reactor, protocol },
    },
    cli: { host: "cli" },
  },
});
