/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Chinese-aware fallbacks: latin glyphs come from Inter/Crimson Pro,
        // CJK glyphs fall through to Noto Sans/Serif SC, then PingFang/MS YaHei
        // on local systems that have them.
        sans: [
          'Inter',
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        serif: [
          '"Crimson Pro"',
          '"Noto Serif SC"',
          '"Source Han Serif SC"',
          '"Times New Roman"',
          'serif',
        ],
      },
      colors: {
        ink: {
          950: '#07090d',
          900: '#0d1117',
          800: '#11161e',
          700: '#1a212c',
          600: '#262f3d',
          500: '#3a4658',
          400: '#566175',
          300: '#7a8597',
          200: '#a3acbb',
          100: '#cdd3dd',
          50: '#eef0f5',
        },
        accent: {
          DEFAULT: '#7dd3fc',
          alt: '#fda4af',
          warm: '#fbbf24',
        },
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
