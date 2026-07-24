"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const BACK_LINK_CLASS = "flex w-fit items-center gap-2 py-1 text-body-airbnb font-bold text-foreground";

// Ровно один из двух: обычный однословный label, ИЛИ crumbs — хлебная
// крошка "Список ‹ Родитель" (напр. zones/[id]: "Зоны ‹ Точка") — запрос
// пользователя 2026-07-24: точка-разделитель заменена на стрелку В ТУ ЖЕ
// СТОРОНУ, что и сама "Назад" (не ChevronRight — уточнение того же дня:
// "стрелка в ту же сторону, влево, как и у Зоны... вернуться к Зонам, как
// настоящие хлебные крошки") — обе стрелки читаются как один и тот же жест
// "назад", а не как обычная forward-хлебная крошка.
type BackLinkProps = { label: ReactNode; crumbs?: undefined } | { label?: undefined; crumbs: ReactNode[] };

interface BackLinkBaseProps {
  onClick?: () => void;
  href?: string;
  className?: string;
}

/**
 * Общая ссылка "Назад" вверху экранов Сотрудника и Владельца — раньше на
 * каждом экране был свой вариант (мелкий текст, или голый "←"/"‹" символ
 * вместо иконки, или точка вместо стрелки между сегментами крошки) —
 * запросы пользователя 2026-07-24: "везде в интерфейсе Сотрудника сделай
 * Назад крупнее" + "у Владельца ← неудобно для хлебных крошек... в разных
 * местах по-разному" + "вместо точки в подобных местах должна быть стрелка
 * тоже". Один общий компонент вместо копипасты — правка теперь в одном
 * месте на все экраны сразу.
 */
export function BackLink({ label, crumbs, onClick, href, className }: BackLinkProps & BackLinkBaseProps) {
  const classes = cn(BACK_LINK_CLASS, className);
  const content = crumbs ? (
    crumbs.map((crumb, i) => (
      <span key={i} className="flex items-center gap-2">
        {i > 0 && <ChevronLeft className="size-5 shrink-0" />}
        {crumb}
      </span>
    ))
  ) : (
    <>{label}</>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        <ChevronLeft className="size-5 shrink-0" />
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      <ChevronLeft className="size-5 shrink-0" />
      {content}
    </button>
  );
}
