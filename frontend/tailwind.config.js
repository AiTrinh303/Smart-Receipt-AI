/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4f46e5', // indigo-600
          hover: '#4338ca', // indigo-700
          soft: '#eef2ff', // indigo-50
        },
        ink: {
          DEFAULT: '#0f172a', // slate-900 (primary text)
          muted: '#475569', // slate-600 (secondary text)
        },
        border: {
          DEFAULT: '#cbd5e1', // slate-300
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
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 2px 8px 0 rgb(0 0 0 / 0.08)',
        lg: '0 8px 24px 0 rgb(0 0 0 / 0.12)',
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

