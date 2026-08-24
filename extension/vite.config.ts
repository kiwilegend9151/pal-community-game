import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  base: "./",

  publicDir: "public",

  build: {
    assetsDir: "",
    rollupOptions: {
      input: {
        index: "index.html",
        config: "config.html"
      }
    }
  },

  server: {
    port: 5173
  }
});