import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
import {config} from "dotenv";

config({path: ".env.local", quiet: true});
export default defineConfig({
  resolve: {alias: {"@": fileURLToPath(new URL("./src", import.meta.url))}},
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false
  }
});
