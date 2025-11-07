/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        'instrument': ['InstrumentSans_400Regular', 'system-ui', 'sans-serif'],
        'instrument-medium': ['InstrumentSans_500Medium', 'system-ui', 'sans-serif'],
        'instrument-semibold': ['InstrumentSans_600SemiBold', 'system-ui', 'sans-serif'],
        'instrument-bold': ['InstrumentSans_700Bold', 'system-ui', 'sans-serif'],
        'instrument-italic': ['InstrumentSans_400Regular_Italic', 'system-ui', 'sans-serif'],
        'instrument-medium-italic': ['InstrumentSans_500Medium_Italic', 'system-ui', 'sans-serif'],
        'instrument-semibold-italic': ['InstrumentSans_600SemiBold_Italic', 'system-ui', 'sans-serif'],
        'instrument-bold-italic': ['InstrumentSans_700Bold_Italic', 'system-ui', 'sans-serif'],
        'inter': ['Inter_400Regular', 'system-ui', 'sans-serif'],
        'inter-medium': ['Inter_500Medium', 'system-ui', 'sans-serif'],
        'inter-semibold': ['Inter_600SemiBold', 'system-ui', 'sans-serif'],
        'inter-bold': ['Inter_700Bold', 'system-ui', 'sans-serif'],
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

