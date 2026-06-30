import {defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/payment-enabler/iyzico-payment-enabler.ts',
      name: 'IyzicoEnabler',
      fileName: 'iyzico-enabler',
      formats: ['es'],
    }
  },
});