import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // react-three-fiber's scene graph is imperative by design: useFrame
    // callbacks mutate Three.js objects (camera, mesh transforms,
    // materials) returned from useThree()/refs on every rendered frame.
    // That's incompatible with the React Compiler's purity assumptions,
    // so it's scoped off for this file only.
    files: ["src/components/hero/PropertyScene.tsx"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
]);

export default eslintConfig;
