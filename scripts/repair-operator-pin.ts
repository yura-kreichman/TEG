import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { verifySecret } from "../src/lib/password-hash";

// Ремонт расхождения между Operator.pin (открытая колонка, она же индекс
// отбора) и Operator.pinHash (единственный источник истины при входе).
//
// Зачем. С 2026-08-13 вход сотрудника ищет кандидата индексом по pin, а не
// перебирает bcrypt по всем сотрудникам тенанта (см. findOperatorByPin —
// перебор стоил 14 с CPU на неверный ПИН при 50 сотрудниках). У этого есть
// условие: pin обязан соответствовать pinHash. Приложение всегда пишет их
// вместе (api/operators, .../reset-pin, install-demo), поэтому само разойтись
// оно их не может — но правка в базе руками или наследие старых данных может.
//
// Чем это грозит. Если pin хранит НЕ тот код, что зашит в pinHash, сотрудник
// не войдёт вообще никогда: по настоящему коду индекс не найдёт строку, а в
// запасной перебор попадают только строки с pin IS NULL — эта туда не входит.
// Раньше, при полном переборе, такой сотрудник входил нормально.
//
// Что делает скрипт. Обнуляет pin у строк, где он не соответствует pinHash.
// Восстановить верное значение неоткуда — из bcrypt-хеша код не достаётся by
// design, — но NULL возвращает строку в запасной перебор, то есть вход
// работает снова, а на первом же успешном входе findOperatorByPin запишет
// колонку заново, уже верную.
//
// Запуск: npx tsx --env-file=.env scripts/repair-operator-pin.ts [--apply]
// Без --apply только показывает, что нашёл, и ничего не меняет.
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {

const operators = await prisma.operator.findMany({
  where: { pin: { not: null } },
  select: { id: true, name: true, pin: true, pinHash: true, active: true, tenant: { select: { name: true } } },
});

const broken: typeof operators = [];
for (const o of operators) {
  if (!(await verifySecret(o.pin!, o.pinHash))) broken.push(o);
}

console.log(`Проверено сотрудников с заполненным pin: ${operators.length}`);
console.log(`Расхождений: ${broken.length}`);
for (const o of broken) {
  console.log(`  ${o.name} («${o.tenant.name}») active=${o.active} id=${o.id}`);
}

if (broken.length > 0) {
  if (apply) {
    await prisma.operator.updateMany({ where: { id: { in: broken.map((o) => o.id) } }, data: { pin: null } });
    console.log(`Обнулён pin у ${broken.length} — вход восстановлен, колонка заполнится сама при следующем входе.`);
    console.log("ВНИМАНИЕ: у этих сотрудников Владелец больше не увидит ПИН в кабинете, пока они не войдут.");
  } else {
    console.log("Ничего не изменено. Повторите с --apply, чтобы починить.");
  }
}

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
