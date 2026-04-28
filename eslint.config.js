import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Chart and registry modules call `registerChart` at import time as
    // a side-effectful registration. Fast-refresh requires component-
    // only exports, but here the non-component export is intentional and
    // never re-rendered after boot. Relax the rule for these paths.
    files: [
      'src/charts/**/*.{ts,tsx}',
      'src/registry.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
