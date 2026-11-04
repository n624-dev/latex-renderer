import base from "../../eslint.config.mjs";
import { fileURLToPath, URL } from "node:url";

// Keep the same typed rules as the repository check while limiting the local
// compiler program to this component's tests and imported declarations. The
// normal CI still runs the complete repository lint and type check.
export default [
  ...base,
  {
    files: [
      "tests/**/*.ts",
      "tests/fixtures/lan-https.ts",
      "tests/server-ingress-nginx.test.ts",
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.lan-https.json",
        tsconfigRootDir: fileURLToPath(new URL("../../", import.meta.url)),
      },
    },
  },
];
