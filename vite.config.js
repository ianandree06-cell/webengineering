import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    base: '/webengineering/',
    plugins: [tailwindcss()],
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                helfen: resolve(__dirname, 'helfen.html'),
                impressum: resolve(__dirname, 'impressum.html'),
                karte: resolve(__dirname, 'karte.html'),
                mitmachen: resolve(__dirname, 'mitmachen.html'),
                defiTutorial: resolve(__dirname, 'defi-tutorial.html'),
            },
        },
    },
})