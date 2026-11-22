// @ts-check
import { default as eslint } from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** These files are typically ignored by eslint by default, so there is no need to investigate why they are ignored. */
const ignoredFiles = [
  "**/node_modules/",
  "**/dist/",
  "**/.ph/",
  "**/storybook-static/",
  "**/.vite/",
  "**/coverage/",
  "gen/",
];

/** Global configs for eslint ignores */
const ignored = globalIgnores(ignoredFiles);

/** Typescript (`.ts`) files */
const typescriptFiles = ["**/*.ts"];

/** Typescript React (`.tsx`) files */
const typescriptReactFiles = ["**/*.tsx"];

/** Javascript (`.js`, `.cjs`, `.mjs`) files */
const javascriptFiles = ["**/*.js", "**/*.cjs", "**/*.mjs"];

/** Typescript rules that we have chosen to opt out of in general */
/** @type {import("eslint").Linter.RulesRecord} */
const typescriptRules = {
  "@typescript-eslint/consistent-type-imports": [
    "error",
    {
      prefer: "type-imports",
      disallowTypeAnnotations: true,
      fixStyle: "separate-type-imports",
    },
  ],
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-unnecessary-condition": "warn",
  "@typescript-eslint/require-await": "warn",
  "@typescript-eslint/no-misused-promises": "warn",
  "@typescript-eslint/no-floating-promises": "warn",
  "@typescript-eslint/no-empty-object-type": "warn",
  "@typescript-eslint/no-duplicate-type-constituents": "warn",
  "@typescript-eslint/restrict-template-expressions": [
    "warn",
    {
      allowNumber: true,
    },
  ],
};

/** Language options for typescript files 
@type {import("eslint").Linter.LanguageOptions} */
const typescriptLanguageOptions = {
  sourceType: "module",
  ecmaVersion: "latest",
  globals: {
    ...globals.browser,
    ...globals.node,
  },
  parserOptions: {
    projectService: {
      allowDefaultProject: ["eslint.config.js", "vitest.config.ts", "main.tsx"],
    },
    tsconfigRootDir: import.meta.dirname,
    ecmaFeatures: {
      jsx: true,
    },
  },
};

/** React plugins */
const reactPlugins = {
  react: reactPlugin,
  "react-hooks": reactHooksPlugin,
};

/** React settings */
const reactSettings = {
  react: {
    version: "detect",
  },
};

/** Typescript config for both `.ts` and `.tsx` files */
const typescriptConfig = {
  files: [...typescriptFiles, ...typescriptReactFiles],
  languageOptions: typescriptLanguageOptions,
  rules: typescriptRules,
};

/** React config for `.tsx` files */
const reactConfig = {
  files: typescriptReactFiles,
  settings: reactSettings,
  plugins: reactPlugins,
};

/** Config for javascript files: all of them are Node scripts (bin, pnpmfile, cli scripts and fixtures) */
const javascriptConfig = {
  // disable type aware linting for js files
  files: javascriptFiles,
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: { globals: globals.node },
};

/** Unsafe-* rules, relaxed where upstream types are `any` or tests build partial mocks */
const unsafeRulesOff = {
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-return": "off",
};

/** The CLI (`cli/`) */
const cliConfigs = [
  {
    files: ["cli/**/*.ts"],
    rules: {
      // The defineCommand contract (and Mastra's async-generator hooks) requires
      // `async` even when the body has no awaits — the rule mis-flags valid code.
      "@typescript-eslint/require-await": "off",
      // Fires on destructured helper exports that don't depend on `this`.
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },
  {
    // cli/src/agents/ is the Mastra boundary, and cli/src/cli.ts wires clint
    // service-lifecycle event handlers whose payloads upstream types as `any`.
    // Disable type-aware unsafe-* and unnecessary-assertion rules here so the
    // strictness still applies to our own code.
    files: ["cli/src/agents/**/*.ts", "cli/src/cli.ts"],
    rules: {
      ...unsafeRulesOff,
      // Mastra's Agent typing disagrees with tsc on whether the template-literal
      // cast is needed; tsc still requires it, so silence the lint complaint.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    // Tests construct partial mocks of framework types (TriggerContext, services,
    // DocumentModelModule, vi.mock factories) where matching the full upstream
    // type is impractical. The unsafe-* rules fire on those mocks; disable them
    // here so the strictness still applies to production code.
    files: ["cli/tests/**/*.ts"],
    rules: {
      ...unsafeRulesOff,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
];

/** Recommended config from eslint */
const eslintRecommendedConfig = eslint.configs.recommended;

/** Recommended config from typescript-eslint */
const typescriptEsLintRecommendedConfig = [
  ...tseslint.configs.recommendedTypeChecked,
];

/**
 * Prettier checks the app folders. The CLI's code was never prettier-formatted:
 * its own config only turned off the rules that clash with prettier
 * (eslint-config-prettier, part of the recommended config below).
 */
const prettierConfigs = [
  eslintPluginPrettierRecommended,
  { files: ["cli/**"], rules: { "prettier/prettier": "off" } },
];

/** Main config */
export default defineConfig(
  ignored,
  eslintRecommendedConfig,
  typescriptEsLintRecommendedConfig,
  typescriptConfig,
  cliConfigs,
  reactConfig,
  javascriptConfig,
  prettierConfigs,
);
