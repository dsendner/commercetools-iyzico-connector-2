import {defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public',
    emptyOutDir: true,
    lib: {
      name: 'Connector',
      entry: "./src/index.ts",
      fileName: (format) => `connector-enabler.${format}.js`,
      formats: ["es"],
    }
  },
});

