/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  theme: {
    extend: {
      colors: {
        panel: '#15171c',
        raised: '#1e2128',
        hover: '#262a33',
        line: 'rgba(255,255,255,0.07)',
        ink: '#e8eaee',
        muted: '#8a909c',
        accent: '#5b8cff',
        danger: '#f05252',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 10px 30px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
      },
    },
  },
  plugins: [],
};
