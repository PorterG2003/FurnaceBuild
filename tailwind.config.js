/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        'manrope': ['Manrope_400Regular', 'system-ui', 'sans-serif'],
        'manrope-medium': ['Manrope_500Medium', 'system-ui', 'sans-serif'],
        'manrope-semibold': ['Manrope_600SemiBold', 'system-ui', 'sans-serif'],
        'manrope-bold': ['Manrope_700Bold', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          orange: '#F3440D',
          'orange-dark': '#D63B0B',
          'orange-light': '#F3683D',
        },
      },
    },
  },
  plugins: [],
}

