"use client";

import { useEffect, useState } from "react";

/**
 * Живое превью адреса-слага по названию компании (докс/spec/08-landing.md —
 * решение пользователя 2026-07-13: показывается при вводе/смене названия,
 * и при регистрации, и при переименовании). Дебаунс 400мс, чтобы не долбить
 * сервер на каждую нажатую клавишу.
 */
export function useSlugPreview(name: string): string | null {
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = name.trim();
    const handle = setTimeout(
      () => {
        if (!trimmed) {
          setSlug(null);
          return;
        }
        fetch(`/api/tenant-slug-preview?name=${encodeURIComponent(trimmed)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => setSlug(data?.slug ?? null))
          .catch(() => {});
      },
      trimmed ? 400 : 0
    );
    return () => clearTimeout(handle);
  }, [name]);

  return slug;
}
