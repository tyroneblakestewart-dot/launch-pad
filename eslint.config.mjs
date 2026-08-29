import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["components/token-studio.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react/jsx-no-comment-textnodes": "off",
    },
  },
  {
    files: ["components/testnet-launcher.tsx"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: [
      "components/provider-launcher.tsx",
      "components/token-allocation-desk.tsx",
      "components/wallet-provider-selector.tsx",
      "components/social-hub.tsx",
      "components/liquidity-lab.tsx",
      "components/bonding-curve-graduation-status.tsx",
      "components/token-page/token-left-column.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Runtime helper for the standalone design-reference mockups in
    // public/design-refs/*.html — not part of the Next.js app bundle.
    "public/support.js",
    // Design references under design/ are never part of the app; the
    // Claude Design runtime (support.js) there is third-party code.
    "design/**",
  ]),
]);
export default eslintConfig;
