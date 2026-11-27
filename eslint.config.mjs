import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.wrangler/**", "**/coverage/**", "client-dist/**", "apps/gateway-worker/worker-configuration.d.ts"] },
  eslint.configs.recommended,
  // Unmodified, hash-pinned historical Node CLI used by compatibility tests.
  { files: ["tests/fixtures/rc3-runtime-image-identity.mjs"], languageOptions: { globals: { process: "readonly" } } },
  { files: ["deploy/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly" } } },
  {
    files: [
      "apps/admin-web/src/browser/admin/*.js", "deploy/scripts/server-setup-browser.js",
      "packages/setup-web/src/setup-browser.js",
    ],
    languageOptions: {
      globals: Object.fromEntries([
        "AbortController", "Blob", "DOMParser", "FormData", "HTMLElement", "Option",
        "TextDecoder", "URL", "URLSearchParams", "clearTimeout", "crypto", "document",
        "fetch", "history", "location", "navigator", "queueMicrotask", "setTimeout", "structuredClone",
      ].map((name) => [name, "readonly"])),
    },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] })),
  {
    files: ["**/*.ts"],
    ignores: ["apps/gateway-worker/**"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { "allowNumber": true }],
    },
  },
  {
    files: ["apps/gateway-worker/**/*.ts"],
    languageOptions: { parserOptions: { project: "./apps/gateway-worker/tsconfig.json", tsconfigRootDir: import.meta.dirname } },
    rules: { "@typescript-eslint/no-floating-promises": "error", "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-confusing-void-expression": "off", "@typescript-eslint/restrict-template-expressions": ["error", { "allowNumber": true }] },
  },
);
