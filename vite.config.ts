import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ and when wrapped later.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
