import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from <user>.github.io/tomtom-orbis-for-devs/ on GitHub Pages,
  // so all bundled asset URLs need that prefix. Locally `npm run dev`
  // ignores this and serves at /.
  base: process.env.GITHUB_ACTIONS ? "/tomtom-orbis-for-devs/" : "/",
});
