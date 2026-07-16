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
      "components/wallet-provider-selector.tsx",
      "components/social-hub.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
