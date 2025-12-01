/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
          dark: '#4338CA',
        },
        accent: '#06B6D4',
      },
      boxShadow: {
        glow: '0 10px 40px rgba(79, 70, 229, 0.25)'
      },
    },
  },
  plugins: [],
};