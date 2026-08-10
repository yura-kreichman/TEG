import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Тот же алиас, что в tsconfig: без него любой тест, чей модуль хоть
      // косвенно тянет i18n (а через него /lang/*.json), падает на разрешении
      // импорта ещё до первого it().
      "@lang": path.resolve(__dirname, "./lang"),
    },
  },
});
