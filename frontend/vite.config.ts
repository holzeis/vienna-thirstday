import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA, type ManifestOptions } from "vite-plugin-pwa";

// `capture_links` isn't in vite-plugin-pwa's bundled manifest types yet
// (it's a newer/experimental manifest field) - extend locally rather than
// dropping type-checking for the whole manifest object.
type ManifestOptionsWithLinkCapture = ManifestOptions & {
  capture_links?: "none" | "new-client" | "existing-client-navigate";
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Vienna Thirstday",
        short_name: "Vienna Thirstday",
        description: "Every Thursday in Vienna — gamedays, standings, and sign-ups.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Best-effort hint: on platforms that support it (some Chromium
        // versions), an in-scope link (e.g. a /join/:token share link)
        // opens in the already-installed app window instead of a new
        // browser tab. No effect on iOS Safari, which never honors this.
        capture_links: "existing-client-navigate",
        orientation: "portrait",
        background_color: "#1c1230",
        theme_color: "#ff7a45",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      } as ManifestOptionsWithLinkCapture,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
