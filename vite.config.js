import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";
import tailwindcss from '@tailwindcss/vite';

function generateManifest() {
  const manifest = readJsonFile("src/manifest.json");
  const pkg = readJsonFile("package.json");
  return {
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    ...manifest,
  };
}

// Get target browser from environment variable
const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    webExtension({
      manifest: generateManifest,
      watchFilePaths: ["package.json", "manifest.json"],
      browser: targetBrowser,
      webExtConfig: {
        chromiumBinary: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      },
    }),
  ],
  build: {
    minify: false,
    outDir: `dist-${targetBrowser}`, // Use different output directories
  }
});
