import { prisma } from "@/lib/prisma";

// Анализ "потерянных клиентов" для Super Admin (запрос пользователя
// 2026-08-02): на фронтальном сайте открытая регистрация, и владельцу
// платформы нужен простой ответ на вопрос "кто просто зарегистрировался и
// ушёл, ничего так и не начав". Не аналитика вовлечённости — только отбор
// заведомо мусорных записей, которые можно снести без потерь.
//
// Порог считается ОТ ДАТЫ РЕГИСТРАЦИИ (решение пользователя из трёх
// предложенных вариантов). Это осознанный компромисс: поля "последний вход"
// в проекте нет ни у User, ни у Tenant (проверена вся схема), поэтому
// буквальное "не заходил 2 месяца" сегодня не измерить — владелец может
// каждый день смотреть отчёты и не оставлять следов в БД. Для целевой группы
// это и не нужно: там сигнал не "давно не заходил", а "за два месяца не
// создано ВООБЩЕ ничего", и он считается по уже имеющимся данным, задним
// числом, без новых полей и без записи активности.
export const CLEANUP_MIN_AGE_DAYS = 60;

export type CleanupVerdict = "deletable" | "abandoned" | "active";

export interface TenantActivityCounts {
  points: number;
  operators: number;
  submissions: number;
  moneyOps: number;
  instructions: number;
  goods: number;
  clients: number;
  hasLanding: boolean;
  hasLogo: boolean;
}

// Зоны и активы намеренно НЕ считаются отдельно: Zone→Point и Asset→Zone
// (schema.prisma), поэтому points === 0 уже гарантирует ноль зон и ноль
// активов. Считать их отдельными запросами — лишняя нагрузка ради того же
// самого ответа.
export function isEmptyTenant(counts: TenantActivityCounts): boolean {
  return (
    counts.points === 0 &&
    counts.operators === 0 &&
    counts.submissions === 0 &&
    counts.moneyOps === 0 &&
    counts.instructions === 0 &&
    counts.goods === 0 &&
    counts.clients === 0 &&
    !counts.hasLanding &&
    !counts.hasLogo
  );
}

export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

interface ClassifiableTenant {
  createdAt: Date;
  unlimited: boolean;
  subscriptionStatus: string;
  fluentcartCustomerId: string | null;
  package: { fluentcartProductId: string | null };
}

/**
 * Три исхода вместо одного "удалять/нет":
 *
 * - `deletable` — Free-регистрация старше порога, за которой НЕТ НИЧЕГО.
 *   Удаление безопасно в буквальном смысле: терять нечего.
 * - `abandoned` — что-то создано, но тенант давно за порогом и не платит.
 *   Это уже не потерянный лид, а бывший клиент с данными. Только пометка,
 *   в массовое удаление такие не попадают НИКОГДА (см. cleanup-роут).
 * - `active` — всё остальное.
 *
 * Отдельно `abandoned` заведён потому, что удаление необратимо и уносит
 * каскадом весь тенант (126 relation'ов с onDelete: Cascade), а прокат
 * детских аттракционов сезонный: зимой простой на несколько месяцев — это
 * норма, а не признак брошенного аккаунта.
 */
export function classifyTenant(tenant: ClassifiableTenant, counts: TenantActivityCounts): CleanupVerdict {
  // Защиты, снимающие тенанта с рассмотрения вообще. Платный пакет и любая
  // привязка к FluentCart — потому что за аккаунтом стоят деньги (тот же
  // принцип, что в DELETE-роуте, который блокирует удаление активной платной
  // подписки). unlimited — ручной рубильник Super Admin'а, такой тенант
  // ведётся вручную в обход биллинга. paused — СЕЗОННАЯ ПАУЗА, которую
  // включает сам владелец: ровно тот случай, когда "тишина два месяца"
  // означает "закрылись на зиму", а не "ушли".
  if (tenant.unlimited) return "active";
  if (tenant.subscriptionStatus === "paused") return "active";
  if (tenant.fluentcartCustomerId) return "active";
  if (tenant.package.fluentcartProductId) return "active";

  if (daysSince(tenant.createdAt) < CLEANUP_MIN_AGE_DAYS) return "active";

  return isEmptyTenant(counts) ? "deletable" : "abandoned";
}

// Один и тот же include для списка тенантов и для повторной проверки при
// массовом удалении — чтобы критерий физически не мог разъехаться между
// "что показали админу" и "что реально удаляем".
export const CLEANUP_INCLUDE = {
  package: { select: { id: true, name: true, fluentcartProductId: true } },
  _count: {
    select: {
      points: true,
      operators: true,
      resultsSubmissions: true,
      moneyOps: true,
      instructions: true,
      goods: true,
      abonementWallets: true,
    },
  },
  landing: { select: { id: true } },
} as const;

type TenantWithCleanupInclude = ClassifiableTenant & {
  logoUrl: string | null;
  landing: { id: string } | null;
  _count: {
    points: number;
    operators: number;
    resultsSubmissions: number;
    moneyOps: number;
    instructions: number;
    goods: number;
    abonementWallets: number;
  };
};

export function countsOf(tenant: TenantWithCleanupInclude): TenantActivityCounts {
  return {
    points: tenant._count.points,
    operators: tenant._count.operators,
    submissions: tenant._count.resultsSubmissions,
    moneyOps: tenant._count.moneyOps,
    instructions: tenant._count.instructions,
    goods: tenant._count.goods,
    clients: tenant._count.abonementWallets,
    hasLanding: tenant.landing !== null,
    // Загруженный логотип — не "содержимое", но однозначный след ручной
    // работы: человек дошёл до настроек и что-то про себя заполнил. Такой
    // тенант в молчаливое массовое удаление попадать не должен.
    hasLogo: Boolean(tenant.logoUrl),
  };
}

/**
 * Повторная классификация ПЕРЕД удалением, по свежим данным из БД — главная
 * защита массового удаления. Админ жмёт "удалить выбранные" по списку,
 * который отрисован из более раннего ответа API; между этими моментами
 * владелец мог зайти и создать первую точку. Роут удаления не доверяет
 * присланным id, а пересчитывает вердикт сам и молча пропускает всех, кто
 * больше не `deletable`.
 */
export async function reclassifyForDeletion(ids: string[]) {
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: ids } },
    include: CLEANUP_INCLUDE,
  });

  const deletable: { id: string; name: string; subscriptionStatus: string }[] = [];
  const skipped: { id: string; name: string; verdict: CleanupVerdict }[] = [];

  for (const tenant of tenants) {
    const verdict = classifyTenant(tenant, countsOf(tenant));
    if (verdict === "deletable") {
      deletable.push({ id: tenant.id, name: tenant.name, subscriptionStatus: tenant.subscriptionStatus });
    } else {
      skipped.push({ id: tenant.id, name: tenant.name, verdict });
    }
  }

  return { deletable, skipped };
}
