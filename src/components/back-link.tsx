"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const BACK_LINK_CLASS = "flex w-fit items-center gap-2 py-1 text-body-airbnb font-bold text-foreground";

interface BackLinkProps {
  label: string;
  onClick?: () => void;
  href?: string;
  className?: string;
}

/**
 * Общая ссылка "Назад" вверху экранов Сотрудника — раньше на каждом экране
 * был свой мелкий text-caption-airbnb вариант (текст ~12.5px, иконка 14px,
 * приглушённый цвет), собранный копипастой в 6 местах — задеть с первого
 * тапа было не так просто (запрос пользователя 2026-07-24: "везде в
 * интерфейсе Сотрудника сделай Назад крупнее"). Один общий компонент вместо
 * дальнейшей копипасты — правка размера теперь в одном месте на все экраны сразу.
 */
export function BackLink({ label, onClick, href, className }: BackLinkProps) {
  const classes = cn(BACK_LINK_CLASS, className);
  if (href) {
    return (
      <Link href={href} className={classes}>
        <ChevronLeft className="size-5" />
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      <ChevronLeft className="size-5" />
      {label}
    </button>
  );
}
