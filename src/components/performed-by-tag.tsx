import { Crown, Users } from "lucide-react";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { cn, colorTagTint } from "@/lib/utils";

// Мини-аватар сотрудника в списках продаж/ревизий/сверок/истории кошелька
// (запрос пользователя 2026-07-19: "фото/иконку сотрудников") — тот же приём
// приоритета, что у крупной карточки оператора в /reports/[pointId] (фото →
// выбранная иконка → первая буква имени), просто в компактном размере под
// однострочные записи. isOwner (действие выполнено Владельцем, не
// Сотрудником) — реальный баг был показан email вместо имени (запрос
// пользователя 2026-07-19: "должно быть написано 'Владелец'"), затем
// заменено на иконку-корону вместо самого слова (запрос пользователя
// 2026-07-22: "везде... иконка crown вместо слова Владелец", позже:
// "достаточно только зелёной иконки... никаких фонов и надписей не надо") —
// единый минимальный маркер "это сделал Владелец" по всему проекту, без
// текста и без фоновой подложки под иконкой.
//
// colorTag — опциональный, опт-ин для конкретного места вызова (запрос
// пользователя 2026-07-31: "во всём разделе Товары... как в Задачах, без
// аватара но с фоном"), тот же вид, что у чипов сотрудников в Задачах/Зонах —
// плашка с плоской 25%-прозрачностью цветовой метки вместо аватара/иконки.
// Когда проп вообще не передан (остальные места вызова, Абонементы) —
// поведение не меняется, старый приём аватар→иконка→Users остаётся.
export function PerformedByTag({
  name,
  isOwner,
  avatarUrl,
  iconKey,
  colorTag,
}: {
  name: string | null;
  isOwner: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag?: string | null;
}) {
  if (isOwner) {
    return <Crown className="size-3.5 shrink-0 text-success" />;
  }
  if (!name) return null;
  if (colorTag !== undefined) {
    return (
      <span
        className={cn("rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground", !colorTag && "bg-surface-0")}
        style={colorTag ? { backgroundColor: colorTagTint(colorTag) } : undefined}
      >
        {name}
      </span>
    );
  }
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
        // Без фона/букв, тот же минимальный принцип, что у иконки-короны
        // Владельца выше (запрос пользователя 2026-07-25: "просто иконку
        // users, а не синий кружок с первой буквой").
        <Users className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      {name}
    </span>
  );
}
