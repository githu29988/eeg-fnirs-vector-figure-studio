import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mathjaxPkg from 'mathjax-full/package.json'

// https://vite.dev/config/
//
// `base` is set so `npm run build` produces asset URLs that work when
// the bundle is served under the project Pages path
// (`https://<user>.github.io/<repo>/`). Resolution order:
//   1. Explicit `BASE_PATH` env var wins (e.g. `BASE_PATH=/ npm run build`
//      for a custom domain or root deploy).
//   2. On GitHub Actions, derive `/repo-name/` from `GITHUB_REPOSITORY`
//      so any fork's deploy workflow Just Works without editing this file.
//   3. Fall back to `/eeg-fnirs-vector-figure-studio/` for local builds.
function resolveBasePath(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH
  const repo = process.env.GITHUB_REPOSITORY
  if (repo && repo.includes('/')) {
    const name = repo.split('/')[1]
    return `/${name}/`
  }
  return '/eeg-fnirs-vector-figure-studio/'
}
const basePath = resolveBasePath()

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
