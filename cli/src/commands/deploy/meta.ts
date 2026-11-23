/** Ids, descriptions and schemas of the deploy commands (see ../spec/meta.ts). */
import { z } from "zod";
import { DEFAULT_PH_VERSION } from "../../constants.js";
import { formatSchema } from "../spec/meta.js";

/** Comma-separated string or array → array of service types. */
export const serviceListSchema = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v.split(",").map((s) => s.trim()).filter(Boolean)
      : v,
  z.array(z.enum(["CONNECT", "SWITCHBOARD", "FUSION"])),
);

/** Comma-separated string or array → array of package specs. */
export const packageListSchema = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v.split(",").map((s) => s.trim()).filter(Boolean)
      : v,
  z.array(z.string()),
);

export const deployEnvironmentListMeta = {
  id: "deploy-environment-list",
  description:
    "List all Vetra Cloud environments (name, domain, status, id, isStudio), including Studio hosts. Requires Renown authorization.",
  inputSchema: z.object({
    scope: z
      .enum(["MINE", "ALL"])
      .default("MINE")
      .describe(
        'Which environments to list: "MINE" (default, your own) or "ALL".',
      ),
    status: z
      .string()
      .optional()
      .describe('Filter by status, e.g. "READY", "DEPLOYING", "DRAFT".'),
  }),
  outputSchema: z.array(z.object({
    name: z.string(),
    domain: z.string().nullable(),
    status: z.string(),
    id: z.string(),
    isStudio: z.boolean().describe('Whether the environment is a Vetra Studio host'),
  })),
};

export const deployEnvironmentGetMeta = {
  id: "deploy-environment-get",
  description:
    "Show a Vetra Cloud deployment environment's details — status, services, and installed packages with their versions (live data; requires Renown authorization — check with whoami). Read $.packages to see which package@version is installed when deciding whether a deploy is needed.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Environment to read — accepts id, name, or subdomain (see deploy-environment-list).",
      ),
    full: z
      .boolean()
      .default(false)
      .describe("Return the full environment object as JSON."),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection over the environment object, e.g. $.status.",
      ),
    format: formatSchema.optional(),
  }),
};

export const deployEnvironmentCreateMeta = {
  id: "deploy-environment-create",
  description:
    "Create a Vetra Cloud deployment environment. A <subdomain>.vetra.io host is assigned automatically; the environment starts in DRAFT with CONNECT enabled. Enabled services are pinned to the local stack's framework version so the deployment matches the Studio. Creates a live environment at staging.vetra.io owned by the signed-in user; requires Renown authorization (check with whoami).",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe("Human-readable environment name (its label)."),
    services: serviceListSchema
      .optional()
      .describe(
        'Services to enable on create, e.g. "CONNECT,SWITCHBOARD". Defaults to CONNECT. One of CONNECT, SWITCHBOARD, FUSION.',
      ),
    version: z
      .string()
      .optional()
      .describe(
        `Leave empty. Enabled services are pinned to the local stack version (${DEFAULT_PH_VERSION}) automatically so the deployment matches the Studio. Only set this to override that default when the user explicitly asks for a specific version, or a known version mismatch justifies it.`,
      ),
  }),
};

export const deployEnvironmentUpdateMeta = {
  id: "deploy-environment-update",
  description:
    "Update a Vetra Cloud deployment environment — rename it, toggle services, manage packages, or drive its deployment status. Pushes signed edits to the live environment at staging.vetra.io; requires Renown authorization (check with whoami).",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe("Environment to update — accepts id, name, or subdomain."),
    label: z.string().optional().describe("New display name."),
    transition: z
      .enum(["CHANGES_APPROVED", "TERMINATING"])
      .optional()
      .describe(
        "Drive the deployment status. CHANGES_APPROVED approves pending changes (from DRAFT/CHANGES_PENDING); TERMINATING terminates the environment.",
      ),
    enableService: serviceListSchema
      .optional()
      .describe('Services to enable, e.g. "SWITCHBOARD,FUSION".'),
    disableService: serviceListSchema
      .optional()
      .describe('Services to disable, e.g. "FUSION".'),
    addPackage: packageListSchema
      .optional()
      .describe(
        'Packages to add as "name@version" (version optional), e.g. "@acme/todo@1.2.0".',
      ),
    removePackage: packageListSchema
      .optional()
      .describe('Package names to remove, e.g. "@acme/todo".'),
  }),
};

export const deployEnvironmentWaitMeta = {
  id: "deploy-environment-wait",
  description:
    "Wait for a Vetra Cloud environment to finish deploying. Polls every 5s and blocks until the status settles (READY, or a failure such as DEPLOYMENT_FAILED) or the timeout elapses — call this once after approving changes instead of polling deploy-environment-get in a loop. If it's still deploying at the timeout it returns the current status; call it again to keep waiting. Requires Renown authorization (check with whoami).",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Environment to wait on — accepts id, name, or subdomain (see deploy-environment-list).",
      ),
    timeout: z
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30)
      .describe("Max seconds to block while polling (default 30, max 300). Polls every 5s."),
  }),
};
