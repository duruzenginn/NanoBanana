/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        indigoBg1: '#0f1126',
        indigoBg2: '#1a1440',
        accent: '#f59e0b',
        primary: '#7c3aed',
        primary2: '#a78bfa'
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0,0,0,0.25)',
        glow: '0 10px 22px rgba(124,58,237,0.35), 0 6px 14px rgba(0,0,0,0.25)'
      },
      borderRadius: {
        xl: '1rem'
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { transform: 'scale(1)', filter: 'brightness(1)' },
          '50%': { transform: 'scale(1.01)', filter: 'brightness(1.05)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        },
        fadeZoomIn: {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        }
      },
      animation: {
        pulseSoft: 'pulseSoft 2.2s ease-in-out infinite',
        shimmer: 'shimmer 1.3s infinite',
        fadeZoomIn: 'fadeZoomIn 400ms ease-out both'
      },
      backdropBlur: {
        xs: '6px'
      }
    }
  },
  plugins: []
}
