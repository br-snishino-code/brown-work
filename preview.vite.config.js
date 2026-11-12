import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], root: 'preview', publicDir: '../public', build: { outDir: '../preview-dist', emptyOutDir: true } });
