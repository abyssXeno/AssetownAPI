/**
 * Génère les icônes PNG des deux applications à partir du logo SVG officiel.
 *   npx electron scripts/make-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="8" y1="6" x2="56" y2="60" gradientUnits="userSpaceOnUse">
      <stop stop-color="#B79BFF"/><stop offset=".55" stop-color="#7C5CFF"/><stop offset="1" stop-color="#3E86FF"/>
    </linearGradient>
    <radialGradient id="bg" cx=".5" cy=".3" r=".9">
      <stop stop-color="#151129"/><stop offset="1" stop-color="#07070D"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#bg)"/>
  <path d="M32 6.5 55 19.2v25.6L32 57.5 9 44.8V19.2L32 6.5Z" fill="url(#g)" stroke="rgba(255,255,255,.22)"/>
  <path d="M32 14.5 47.5 23v18L32 49.5 16.5 41V23L32 14.5Z" fill="#0A0A14"/>
  <path d="M32 20 41 43h-4.8l-1.8-4.9h-4.8L27.8 43H23L32 20Zm0 8.2-1.4 4.5h2.8L32 28.2Z" fill="url(#g)"/>
</svg>`;

const targets = [
  path.resolve("apps/launcher/build/icon.png"),
  path.resolve("apps/admin/build/icon.png"),
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const buffer = image.toPNG();
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    console.log(`icône écrite : ${target} (${Math.round(buffer.length / 1024)} Ko)`);
  }
  window.destroy();
  app.quit();
});
