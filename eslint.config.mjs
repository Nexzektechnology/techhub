import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ['scripts/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['tests/offline/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['server.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  // The standalone offline shell has no Next router; links must navigate fully.
  { files: ['src/offline/main.tsx'], rules: { '@next/next/no-html-link-for-pages': 'off' } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    ".next-tenant-e2e/**",
    ".next-preview/**",
    "test-results/**",
    "playwright-report/**",
    "artifacts/**",
    ".data/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/bizhub-offline.js",
    "public/bizhub-sw.js",
  ]),
]);

export default eslintConfig;
