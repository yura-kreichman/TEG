import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit грузит свои .afm файлы шрифтов по пути относительно __dirname во
  // время выполнения (docs/spec/07-instructions.md, PDF-генерация) — бандлинг
  // Next в Route Handler ломает этот путь ("C:\ROOT\node_modules\pdfkit\..."),
  // не входит в короткий список автовынесенных пакетов Next (sharp/prisma и
  // т.п. — там уже есть, поэтому раньше это не всплывало). serverExternalPackages
  // заставляет грузить пакет через нативный require из настоящего node_modules.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
