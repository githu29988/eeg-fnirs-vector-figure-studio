import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mathjaxPkg from 'mathjax-full/package.json'

// https://vite.dev/config/
//
// `base` is set so `npm run build` produces asset URLs that work both
// when the bundle is served at the root (e.g. `dist/index.html` opened
// via `file://`) and when it is served under the project Pages path
// (`https://<user>.github.io/<repo>/`). Set `BASE_PATH` in the build
// environment to override (e.g. `BASE_PATH=/ npm run build` for a
// custom domain or root deploy).
const basePath = process.env.BASE_PATH ?? '/960eeg-fnirs-vector-figure-studio/'

export default defineConfig({
  base: basePath,
  plugins: [react()],
  define: {
    // mathjax-full's `version.js` reads its version from package.json via
    // `eval('require')` when `PACKAGE_VERSION` is not defined. The eval
    // path does not work in browser builds, so we inline the version at
    // build time and short-circuit the runtime detection.
    PACKAGE_VERSION: JSON.stringify(mathjaxPkg.version),
  },
})
