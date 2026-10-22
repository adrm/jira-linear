/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: { target: "es2022" },
  resolve: { alias: { "@shared": shared } },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/api": "http://127.0.0.1:8766" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,
  },
});
