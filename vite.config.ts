import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    host: "127.0.0.1",
    port: 3001,
    strictPort: true,
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    nitro({
      devProxy: {
        "/api/**": {
          target: "http://127.0.0.1:8001",
          changeOrigin: true,
        },
        "/sanctum/**": {
          target: "http://127.0.0.1:8001",
          changeOrigin: true,
        },
      },
    }),
    viteReact(),
  ],
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "INVALID_ANNOTATION" &&
          warning.id?.includes("node_modules")
        ) {
          return
        }
        warn(warning)
      },
    },
  },
})

export default config
