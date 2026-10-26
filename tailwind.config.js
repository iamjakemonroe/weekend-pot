/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        raised: '#12151c',
        line: '#232733',
        ink: '#eef1f6',
        muted: '#9aa2b1',
        faint: '#6b7383',
        gold: '#f2c14e',
        win: '#2fd497',
        warn: '#ffb547',
        danger: '#ff6b6b',
      },
      fontFamily: { sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
