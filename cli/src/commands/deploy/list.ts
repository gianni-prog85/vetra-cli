import { defineCommand } from "../../framework.js";
import { deployEnvironmentListMeta } from "./meta.js";
import { CLOUD_BASE_DOMAIN } from "../../../../cloud-client/index.js";
import { listEnvironmentsWithStudioFlag } from "../../cloud/environments-write.js";

/** Public host for an environment: custom domain wins, else the generated
 * subdomain under the cloud base domain; null when neither is set. */
function domainOf(e: {
  subdomain: string | null;
  customDomain: string | null;
}): string | null {
  return (
    e.customDomain ??
    (e.subdomain ? `${e.subdomain}.${CLOUD_BASE_DOMAIN}` : null)
  );
}

export const deployEnvironmentList = defineCommand({
  ...deployEnvironmentListMeta,
  execute: async (input, { workdir, config }) => {
    let items = await listEnvironmentsWithStudioFlag(
      { workdir, config },
      input.scope,
    );
    if (input.status) {
      const want = input.status.toUpperCase();
      items = items.filter((e) => (e.status ?? "").toUpperCase() === want);
    }
    return items.map((e) => ({
      name: e.name,
      domain: domainOf(e),
      status: e.status,
      id: e.id,
      isStudio: e.isStudio,
    }));
  },
});
