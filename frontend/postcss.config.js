// Not read by Vite: vite.config.ts passes Tailwind and Autoprefixer inline
// (css.postcss), so the Tailwind config is re-read whenever it changes.
// Kept for any other PostCSS tool; keep both lists in step.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
