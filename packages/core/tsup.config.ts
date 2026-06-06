import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/http.ts",
    "src/exact/client.ts",
    "src/exact/verify.ts",
    "src/exact/settle.ts",
    "src/facilitator.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
});
