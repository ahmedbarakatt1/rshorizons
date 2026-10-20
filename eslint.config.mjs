import {defineConfig, globalIgnores} from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {files:["src/**/*.tsx"],plugins:{"react-hooks":hooks},rules:{"react-hooks/rules-of-hooks":"error","react-hooks/exhaustive-deps":"warn"}},
  {files:["scripts/**/*.mjs"],languageOptions:{globals:{process:"readonly",console:"readonly",Buffer:"readonly",URL:"readonly",fetch:"readonly",setTimeout:"readonly"}}},
  globalIgnores([".next/**", ".tooling/**", ".agents/**", ".local/**", "next-env.d.ts"])
]);
