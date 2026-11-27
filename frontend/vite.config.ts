import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'vite'
import tailwindConfig from './tailwind.config.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    // Tailwind gets its config as an *object* imported here, not as a file
    // path it loads itself. Why: on Node 22, Tailwind 3 loads an ESM
    // `tailwind.config.js` with `require()`, which lands in Node's ESM
    // cache; its reload trick (`delete require.cache[file]`) can't evict
    // that, so a running `npm run dev` never saw new theme tokens (e.g.
    // `apartment.fuchsia`): the class names were in the markup but
    // generated no CSS. Imported here instead, the config is part of
    // Vite's own config bundle: Vite restarts by itself when
    // tailwind.config.js changes and re-reads it fresh. An inline
    // `postcss` config also means Vite no longer reads postcss.config.js.
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()],
    },
  },
})
