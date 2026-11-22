/**
 * Pins the `external-packages` cascade layer to the lowest priority in the
 * built Connect bundle's `index.html`.
 *
 * Connect's package manager mounts runtime-loaded package stylesheets as
 * `@import url(...) layer(external-packages)`. Cascade-layer priority follows
 * declaration order, so the layer must be declared before any other layer to
 * sit at the bottom. The bundled Connect CSS does not declare it, which makes
 * the runtime mount the LAST declared layer — the highest priority — letting
 * a registry-served package stylesheet override the app's own styles.
 *
 * `pnpm build:connect` applies it once, after `ph-cli connect build`
 * (`cli/scripts/pin-connect-layer.ts`): the Cli never writes into the
 * installed package.
 */

export const LAYER_STYLE = "<style>@layer external-packages;</style>";

/**
 * `html` with {@link LAYER_STYLE} first in its `<head>`, before any
 * stylesheet. Unchanged when it is already there; null when there is no
 * `<head>`.
 */
export function pinExternalPackagesLayer(html: string): string | null {
  if (html.includes(LAYER_STYLE)) return html;
  const headOpen = html.indexOf("<head>");
  if (headOpen === -1) return null;
  const insertAt = headOpen + "<head>".length;
  return html.slice(0, insertAt) + LAYER_STYLE + html.slice(insertAt);
}
