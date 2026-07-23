import {defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public',
    emptyOutDir: true,
    lib: {
      name: 'IyzicoEnabler',
      entry: "./src/index.ts",
      fileName: "iyzico-enabler",
      formats: ["es"],
    }
  },
});

