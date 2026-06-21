import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/main/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/preload/index.ts")
      }
    }
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer")
      }
    }
  }
});
