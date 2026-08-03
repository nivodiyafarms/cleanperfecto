import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
      // Next.js aliases "server-only" to this no-op shim at build time for
      // server-side code; replicate that here so tests can import
      // server-only modules directly.
      "server-only": path.resolve(rootDir, "./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
