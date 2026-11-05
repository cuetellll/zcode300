/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        rail: 'var(--bg-rail)',
        sidebar: 'var(--bg-sidebar)',
        chat: 'var(--bg-chat)',
        elevated: 'var(--bg-elevated)',
        floating: 'var(--bg-floating)',
        input: 'var(--bg-input)',
        'brand-primary': 'var(--brand-primary)',
        'brand-accent': 'var(--brand-accent)',
        'status-online': 'var(--status-online)',
        'status-idle': 'var(--status-idle)',
        'status-dnd': 'var(--status-dnd)',
        'status-offline': 'var(--status-offline)',
      },
      boxShadow: {
        glow: '0 0 12px var(--brand-glow)',
      },
    },
  },
  plugins: [],
};
