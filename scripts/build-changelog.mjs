// Сборка публичной истории изменений: changelog/seed.json + трейлеры коммитов
// → changelog/releases.json. Правила — changelog/README.md.
//
// Обычный node без единой зависимости и без tsx: скрипт обязан выполняться
// внутри сборочного слоя Docker, где стоят только node и исходники (npm ci
// уже прошёл, но запускать tsx ради тридцати строк логики незачем).
//
// Откуда берутся коммиты, по порядку:
//   1. changelog/commits.txt — дамп, который кладёт deploy/deploy.sh из голого
//      репозитория на сервере. В образе .git нет вовсе, поэтому на проде
//      работает только этот путь.
//   2. локальный `git log` — для предпросмотра на машине разработки
//      (`npm run changelog`).
//   3. ничего — тогда берётся только seed, и об этом печатается предупреждение.
//      Молча отдать урезанную историю нельзя: это выглядело бы как «за месяц
//      ничего не менялось».
//
// Трейлер в сообщении коммита (последней строкой, можно несколько):
//   Changelog: fix | ru: Деньги — раздел открывается ... | en: Money — ...
// Тип: feat | impr | fix. Английский необязателен — тогда останется русский.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = join(root, "changelog", "seed.json");
const dumpPath = join(root, "changelog", "commits.txt");
const outPath = join(root, "changelog", "releases.json");

// Разделители внутри дампа: \x1f между полями, \x1e между коммитами. Обычные
// символы (|, ;, ---) здесь не годятся — тело коммита многострочное и вполне
// может содержать любой из них.
const FIELD = "\x1f";
const RECORD = "\x1e";
const GIT_FORMAT = `%H${FIELD}%ad${FIELD}%B${RECORD}`;
const TYPES = new Set(["feat", "impr", "fix"]);

function readCommits() {
  if (existsSync(dumpPath)) {
    return { source: `дамп ${dumpPath}`, raw: readFileSync(dumpPath, "utf8") };
  }
  try {
    const raw = execFileSync(
      "git",
      ["log", "--reverse", "--date=short", `--pretty=${GIT_FORMAT}`],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    return { source: "локальный git log", raw };
  } catch {
    return { source: null, raw: "" };
  }
}

function parseCommits(raw) {
  return raw
    .split(RECORD)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha, day, ...rest] = chunk.split(FIELD);
      return { sha: sha.trim(), day: (day ?? "").trim(), body: rest.join(FIELD) };
    })
    .filter((c) => /^[0-9a-f]{7,40}$/.test(c.sha) && /^\d{4}-\d{2}-\d{2}$/.test(c.day));
}

// Из одного коммита может выйти несколько записей — по строке на каждую.
function parseTrailers(body) {
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*Changelog:\s*(.+)$/i.exec(line);
    if (!m) continue;

    const parts = m[1].split("|").map((p) => p.trim());
    const type = parts.shift()?.toLowerCase();
    if (!TYPES.has(type)) {
      console.warn(`  ! неизвестный тип записи "${type}" — строка пропущена: ${line.trim()}`);
      continue;
    }

    const text = {};
    for (const part of parts) {
      const lm = /^([a-z]{2})\s*:\s*(.+)$/i.exec(part);
      if (lm) text[lm[1].toLowerCase()] = lm[2].trim();
      else if (!text.ru) text.ru = part; // язык не указан — считаем русским
    }
    if (!text.ru && !text.en) {
      console.warn(`  ! запись без текста — пропущена: ${line.trim()}`);
      continue;
    }
    out.push({ type, text });
  }
  return out;
}

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const { source, raw } = readCommits();
if (!source) {
  // Без истории коммитов пересобирать нечего. Если готовый файл уже лежит
  // (обычный случай: локальная сборка образа из чекаута) — оставляем его как
  // есть. Затереть его одним seed значило бы тихо выбросить всё, что вышло
  // после бэкфила, и показать клиенту «за месяц ничего не менялось».
  if (existsSync(outPath)) {
    console.warn("! Коммиты недоступны — оставляю changelog/releases.json без изменений.");
    process.exit(0);
  }
  console.warn("! Коммиты недоступны и готового файла нет — собираю только seed.");
}

const commits = parseCommits(raw);
const anchorIndex = commits.findIndex((c) => c.sha === seed.anchor.sha);
if (source && anchorIndex === -1 && commits.length) {
  // Коммит-якорь обязан быть в истории: если его нет, значит дамп чужой или
  // историю переписали. Собрать «всё подряд» в такой ситуации — верный способ
  // задублировать бэкфил, поэтому падаем.
  throw new Error(
    `Якорный коммит ${seed.anchor.sha} не найден в истории (${source}). ` +
      `Проверьте changelog/seed.json и дамп коммитов.`
  );
}

// Группировка по календарным дням: один день = один релиз, сколько бы деплоев
// в нём ни было (changelog/README.md, «Нумерация»).
const byDay = new Map();
for (const commit of commits.slice(anchorIndex + 1)) {
  const entries = parseTrailers(commit.body);
  if (!entries.length) continue;
  const day = byDay.get(commit.day) ?? [];
  for (const entry of entries) {
    // Одна и та же формулировка в серии коммитов одного дня — одна запись.
    if (day.some((e) => e.text.ru === entry.text.ru && e.text.en === entry.text.en)) continue;
    day.push(entry);
  }
  byDay.set(commit.day, day);
}

const fresh = [...byDay.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([day, entries]) => ({ version: null, day, entries }));

// Версии считаются заново по всей истории, от старых к новым: minor — если в
// релизе есть хоть одна запись feat, иначе patch. Номера в seed.json тоже
// пересчитываются, а не берутся на веру, — так правило проверяется на каждой
// сборке, и рассинхрон между seed и правилом невозможен.
const releasesAsc = [...seed.releases].reverse().concat(fresh);
let major = 1;
let minor = 0;
let patch = 0;
releasesAsc.forEach((release, i) => {
  if (i > 0) {
    if (release.entries.some((e) => e.type === "feat")) {
      minor += 1;
      patch = 0;
    } else {
      patch += 1;
    }
  }
  release.version = `${major}.${minor}.${patch}`;
});

const releases = releasesAsc.reverse();
const anchor = commits.length ? commits[commits.length - 1] : seed.anchor;

writeFileSync(
  outPath,
  JSON.stringify(
    {
      note: "СГЕНЕРИРОВАННЫЙ ФАЙЛ. Правьте changelog/seed.json или трейлер Changelog: в коммите — см. changelog/README.md.",
      version: releases[0]?.version ?? "1.0.0",
      anchor: { sha: anchor.sha, day: anchor.day },
      releases,
    },
    null,
    2
  ) + "\n"
);

const entryCount = releases.reduce((n, r) => n + r.entries.length, 0);
console.log(
  `История изменений: ${releases.length} релизов, ${entryCount} записей, ` +
    `текущая версия ${releases[0]?.version}. Источник коммитов: ${source ?? "нет"}` +
    (fresh.length ? `, новых релизов из трейлеров: ${fresh.length}` : "")
);
