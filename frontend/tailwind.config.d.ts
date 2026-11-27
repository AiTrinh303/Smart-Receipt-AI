// Types for `import tailwindConfig from './tailwind.config.js'` in
// vite.config.ts (the config is plain JS, so TypeScript needs this).
import type { Config } from 'tailwindcss'

declare const config: Config
export default config
