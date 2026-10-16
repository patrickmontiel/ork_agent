import type { Config } from "tailwindcss";

// Sistema de identidad Ork v1.0.
// Fuente de verdad de la paleta: la lámina de identidad. Nada de hex sueltos en
// componentes — todo sale de aquí o de las variables de globals.css.
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Morado primario — botones, acentos, el punto del logo.
        primary: {
          DEFAULT: "#6C2EFF",
          hover: "#7D45FF",
          press: "#5A1FE0",
          soft: "rgba(108, 46, 255, 0.12)",
        },
        // Violeta de acento — gradientes, datos, estados activos.
        // Escala completa a propósito: definir solo `violet.DEFAULT` borraría
        // la escala numérica de Tailwind y las clases violet-400/500/50 que ya
        // usa app/page.tsx dejarían de generarse, en silencio. Anclada en el
        // #A959FF de la lámina de identidad, que vive en el 500.
        violet: {
          50: "#F5EDFF",
          100: "#EADBFF",
          200: "#D7BBFF",
          300: "#C495FF",
          400: "#B575FF",
          500: "#A959FF",
          600: "#8F3DEB",
          700: "#742DC4",
          800: "#5A229B",
          900: "#421A72",
          DEFAULT: "#A959FF",
          soft: "rgba(169, 89, 255, 0.14)",
        },
        // Fondos.
        navy: "#0B0D17",
        slate: "#1C1F2A",
        // Neutros claros.
        mist: "#F2F4F7",
        white: "#FFFFFF",

        // Semánticos. Separados del acento a propósito: el morado es marca,
        // estos son estado.
        ok: "#34D399",
        warn: "#FBBF24",
        danger: "#F87171",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        control: "10px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.4), 0 16px 48px -24px rgba(0,0,0,.8)",
        glow: "0 12px 48px -12px rgba(108, 46, 255, 0.45)",
      },
      spacing: {
        // Mínimo táctil accesible. Úsalo en todo lo clickeable.
        touch: "44px",
      },
    },
  },
  plugins: [],
};
export default config;
