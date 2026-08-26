import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.wrangler/**", "**/coverage/**", "client-dist/**", "apps/gateway-worker/worker-configuration.d.ts"] },
  eslint.configs.recommended,
  { files: ["deploy/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly" } } },
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
