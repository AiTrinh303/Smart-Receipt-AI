/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4f46e5', // indigo-600
          hover: '#4338ca', // indigo-700
          soft: '#eef2ff', // indigo-50 -- small fills: badge/pill/chip backgrounds, icon tints
          subtle: '#e0e7ff', // indigo-100 -- larger selected-background fills: a chosen RadioCardGroup card, the idle dropzone
        },
        ink: {
          DEFAULT: '#0f172a', // slate-900 (primary text)
          muted: '#475569', // slate-600 (secondary text)
        },
        border: {
          DEFAULT: '#64748b', // slate-500 (4.76:1 on white -- slate-300 was 1.48:1, failing the 3:1 non-text minimum)
          subtle: '#e2e8f0', // slate-200 -- decorative containers only (Card, panels): never an interactive control, a selectable card, or a dropzone, which keep border-border/border-brand above
        },
        surface: {
          DEFAULT: '#ffffff',
          page: '#f8fafc', // slate-50
        },
        success: {
          DEFAULT: '#15803d', // green-700
          soft: '#f0fdf4', // green-50
        },
        warning: {
          DEFAULT: '#a16207', // yellow-700
          soft: '#fefce8', // yellow-50
        },
        danger: {
          DEFAULT: '#b91c1c', // red-700
          soft: '#fef2f2', // red-50
        },
      },
      borderRadius: {
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        control: '0.5rem', // 8px -- buttons, inputs, selects, selectable cards
        card: '0.75rem', // 12px -- Card and other decorative containers
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 2px 8px 0 rgb(0 0 0 / 0.08)',
        lg: '0 8px 24px 0 rgb(0 0 0 / 0.12)',
        // Ink-tinted (not pure black) for a calmer, warmer elevation.
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.08)',
        popover: '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 12px 24px -4px rgb(15 23 42 / 0.12)',
      },
      fontSize: {
        // caption (12/16), small (14/20) and body (16/24) already match
        // Tailwind's own text-xs/text-sm/text-base defaults exactly -- kept
        // implicit rather than redefined. Only the page-title size is new.
        title: ['1.75rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em', fontWeight: '600' }], // 28/36 semibold, tight tracking
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}

