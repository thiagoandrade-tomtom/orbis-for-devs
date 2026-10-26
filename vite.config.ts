import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from <user>.github.io/<repo>/ on GitHub Pages, so all bundled
  // asset URLs need that prefix. Taken from the repo name Actions runs
  // in, so the same config deploys from any repo. Locally `npm run dev`
  // ignores this and serves at /.
  base: process.env.GITHUB_ACTIONS
    ? `/${(process.env.GITHUB_REPOSITORY ?? "/tomtom-orbis-for-devs").split("/")[1]}/`
    : "/",
});
