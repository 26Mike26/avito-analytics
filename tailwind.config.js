/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // class-strategy: переключение темы через `<html class="light">`/`<html class="dark">`.
  // По умолчанию dark — наш фирменный режим.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Базовые токены под фирменный стиль (тёмная тема, оранжевый акцент)
        ink: {
          950: '#08080a', // самый тёмный фон
          900: '#0d0d10', // основной фон
          850: '#131318', // второстепенный фон
          800: '#1a1a20', // карточка
          750: '#22222a', // карточка-elevated
          700: '#2a2a33', // border
          600: '#3a3a45',
          500: '#5a5a66',
          400: '#7d7d8a',
          300: '#a8a8b3',
          200: '#cfcfd6',
          100: '#e8e8ec',
          50: '#f4f4f7',
        },
        accent: {
          DEFAULT: '#FF6A00',
          50: '#fff2e6',
          100: '#ffd9b0',
          200: '#ffb778',
          300: '#ff9447',
          400: '#ff7a1a',
          500: '#FF6A00',
          600: '#e05c00',
          700: '#b84a00',
          800: '#8c3800',
          900: '#5e2500',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,106,0,0.15), 0 0 24px rgba(255,106,0,0.20)',
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.45)',
      },
      backgroundImage: {
        'silk':
          'radial-gradient(120% 80% at 50% -10%, rgba(255,106,0,0.06) 0%, rgba(255,106,0,0) 50%), linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0.015) 70%, rgba(255,255,255,0) 100%)',
      },
    },
  },
  plugins: [],
};
