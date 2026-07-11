import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RentOS",
    short_name: "RentOS",
    description: "RentOS SaaS",
    start_url: "/",
    display: "standalone",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      {
        src: "/icon-library/app-icons/PWA/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-library/app-icons/PWA/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      // Несколько размеров maskable-иконки, не только 512 — некоторые
      // Android-лаунчеры (замечено на Samsung: "что-то добавляется, но
      // криво") берут ближайший подходящий размер для иконки на главном
      // экране, а не масштабируют один большой файл. Размеры 180/192/512
      // подсмотрены у Progressify (WP-плагин с рабочей PWA-установкой на
      // тех же устройствах, см. Progressify/includes/.../PwaAssets.php —
      // processMaskableIconVariants() генерирует ровно эти три размера).
      {
        src: "/icon-library/app-icons/PWA/icon-180-maskable.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-library/app-icons/PWA/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-library/app-icons/PWA/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
