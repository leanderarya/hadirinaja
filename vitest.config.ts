import { fileURLToPath } from "node:url"

export default {
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./src/vitest.setup.ts"],
  },
}
