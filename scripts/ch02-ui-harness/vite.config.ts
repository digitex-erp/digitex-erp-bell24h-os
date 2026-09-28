import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// root = repo root so Tailwind v4's source scan covers src/ (otherwise no utility classes are generated).
export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_KEY": JSON.stringify("") },
  build: { outDir: path.resolve(__dirname, "dist"), emptyOutDir: true, rollupOptions: { input: path.resolve(__dirname, "index.html") } },
});
