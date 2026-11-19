import { fileURLToPath } from 'node:url';

export default {
  plugins: {
    // Explicit path: Tailwind otherwise looks for its config in the process's
    // working directory, which isn't web-source when the dev server is
    // launched from elsewhere, and silently generates no utilities.
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
};
