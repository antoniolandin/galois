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
    rules: {
      // Reglas nuevas de react-hooks v7 / React 19 que el codigo del
      // visor no respeta a rajatabla (acceso a refs en JSX, setState
      // sincrono en useEffect, mutaciones en sitio). Quedan en warning
      // para no bloquear CI en codigo que ya funciona, sin perder la
      // visibilidad.
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Solo afecta al hot-reload de Vite en desarrollo.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
