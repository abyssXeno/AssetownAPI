import { build } from "esbuild";

await build({
  entryPoints: {
    main: "src/main/main.ts",
    preload: "src/preload/index.ts",
  },
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
  outExtension: { ".js": ".cjs" },
});
