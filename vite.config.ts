import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mathjaxPkg from 'mathjax-full/package.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // mathjax-full's `version.js` reads its version from package.json via
    // `eval('require')` when `PACKAGE_VERSION` is not defined. The eval
    // path does not work in browser builds, so we inline the version at
    // build time and short-circuit the runtime detection.
    PACKAGE_VERSION: JSON.stringify(mathjaxPkg.version),
  },
})
