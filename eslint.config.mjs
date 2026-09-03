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
      // Both effects flagged here are the standard hydration-safe pattern
      // (default false/null, flip to the real value only after mount) —
      // ?chartDebug=1 must read `window.location.search`, which isn't
      // available during SSR, and the debug snapshot's own live values can
      // only be read from lightweight-charts refs inside an effect, never
      // during render (issue #472 item 2).
      "components/token-page/token-trade-chart.tsx",
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
