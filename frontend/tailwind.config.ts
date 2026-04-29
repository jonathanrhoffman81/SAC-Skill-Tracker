/**
 * Tailwind CSS configuration
 * Purpose: configure Tailwind's theme, plugins, and content paths for the frontend.
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  safelist: [
    'bg-blue-100', 'text-blue-800',
    'bg-emerald-100', 'text-emerald-800',
    'bg-amber-100', 'text-amber-800',
    'bg-fuchsia-100', 'text-fuchsia-800',
    'bg-cyan-100', 'text-cyan-800',
    'bg-lime-100', 'text-lime-800',
    'bg-rose-100', 'text-rose-800',
    'bg-violet-100', 'text-violet-800',
    'bg-orange-100', 'text-orange-800',
    'bg-teal-100', 'text-teal-800',
    'bg-indigo-100', 'text-indigo-800',
    'bg-pink-100', 'text-pink-800',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
