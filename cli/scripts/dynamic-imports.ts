// Bare `import("<pkg>")` calls a bundle keeps resolve at runtime from the
// installed dependencies, exactly like a leftover `__require`. @mastra/core
// loads the workspace shell's `execa` this way (`const mod = "execa"; await
// import(mod)`, which rolldown inlines to `import(/* @vite-ignore */ "execa")`
// without bundling it), so `execa` must be installed next to the bundle.
// Only imports marked `@vite-ignore` (deliberately left unbundled): plain
// `import("x")` text also appears in bundled docs and comments.
const DYNAMIC_IMPORT =
  /\bimport\(\s*(?:\/\*[^*]*\*\/\s*)*\/\*\s*@vite-ignore\s*\*\/\s*(?:\/\*[^*]*\*\/\s*)*["']([^"'.][^"']*)["']\s*\)/g;
const PACKAGE_SPEC = /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.@-]+)*$/;

/** Package specifiers `code` loads through an unbundled `import("…")`. */
export function findBareDynamicImports(code: string): string[] {
  const specs = [...code.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]);
  return [...new Set(specs.filter((s) => PACKAGE_SPEC.test(s)))].sort();
}
