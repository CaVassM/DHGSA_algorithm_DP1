/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0f172a',
          card: '#1e293b',
          border: '#334155',
          accent: '#3b82f6',
          muted: '#94a3b8',
          green: '#22c55e',
          amber: '#f59e0b',
          red: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
