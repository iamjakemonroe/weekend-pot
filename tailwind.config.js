/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#06080c',
        raised: '#0e1118',
        line: '#222736',
        ink: '#eef1f6',
        muted: '#9aa2b1',
        faint: '#6b7383',
        gold: '#f2c14e',
        cyan: '#38d6ff',
        win: '#2fd497',
        warn: '#ffb547',
        danger: '#ff6b6b',
      },
      fontFamily: {
        sans: ['Inter Variable', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Space Grotesk Variable', 'Inter Variable', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
