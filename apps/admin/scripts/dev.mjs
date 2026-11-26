import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const urls = server.resolvedUrls?.local ?? [];
const url = urls[0] ?? "http://127.0.0.1:5184/";
server.printUrls();

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: "development" },
});

child.on("close", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  child.kill();
  server.close().finally(() => process.exit(0));
});
