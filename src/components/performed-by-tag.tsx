import { Crown } from "lucide-react";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";

// Мини-аватар сотрудника в списках продаж/ревизий/сверок/истории кошелька
// (запрос пользователя 2026-07-19: "фото/иконку сотрудников") — тот же приём
// приоритета, что у крупной карточки оператора в /reports/[pointId] (фото →
// выбранная иконка → первая буква имени), просто в компактном размере под
// однострочные записи. isOwner (действие выполнено Владельцем, не
// Сотрудником) — реальный баг был показан email вместо имени (запрос
// пользователя 2026-07-19: "должно быть написано 'Владелец'"), затем
// заменено на иконку-корону вместо самого слова (запрос пользователя
// 2026-07-22: "везде... иконка crown вместо слова Владелец") — единый
// визуальный маркер "это сделал Владелец" по всему проекту, не только в
// Товарах, где он появился впервые.
export function PerformedByTag({
  name,
  isOwner,
  avatarUrl,
  iconKey,
}: {
  name: string | null;
  isOwner: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
}) {
  const t = useI18n();
  if (isOwner) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success/10">
          <Crown className="size-3 text-success" />
        </span>
        {t.common.ownerLabel}
      </span>
    );
  }
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-4 shrink-0 rounded-full object-cover" />
      ) : iconKey ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <AssetOrZoneIcon iconKey={iconKey} className="size-3" />
        </span>
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[0.5625rem] font-bold text-primary-foreground">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {name}
    </span>
  );
}
