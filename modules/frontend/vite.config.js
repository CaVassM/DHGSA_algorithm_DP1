import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // G06: `host: true` hace que el servidor de desarrollo escuche en todas las
  // interfaces de red, no solo en localhost. Sin esto, otro dispositivo de la
  // red ni siquiera puede abrir la página del visualizador. Al arrancar, Vite
  // imprime la dirección "Network:" que hay que teclear en el segundo equipo.
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5173,
  },
})
