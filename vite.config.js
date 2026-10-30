/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { noticesPath } from "./notices-source.mjs";

/**
 * `virtual:notices`: the engine's THIRD-PARTY-NOTICES.md as a string, read when
 * the page is built. Resolved from the installed package rather than a path
 * into node_modules, and failing the build in words when it is not there.
 */
function notices() {
  const id = "virtual:notices";
  return {
    name: "notices",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null;
      let file;
      try {
        file = noticesPath();
      } catch (e) {
        return this.error(e.message);
      }
      this.addWatchFile(file);
      return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), notices()],
  server: {
    port: 5173,
    // The engine packages are linked from the engine repository beside this
    // one (`file:` dependencies), and dev-mode Vite serves nothing above its
    // own root by default -- without this an import is a 403 that reads like a
    // missing file.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The Steam sign-in is a page of its own (/steam), apart from the app.
    rollupOptions: { input: { main: "index.html", steam: "steam.html" } },
  },
});
