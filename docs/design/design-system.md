# Дизайн-система RentOS

**Эта система едина для всех интерфейсов продукта** — кабинета владельца, PWA
оператора и любых будущих модулей. Роль определяет только тему (светлая/тёмная)
и точки уличного контраста для оператора (см. `docs/spec/03-design-system.md`,
раздел «Границы применения») — токены, типографика и UI-паттерны ниже общие.

**Источники, в порядке приоритета при противоречии:**
1. `docs/design/prototype-owner-v2.html` — визуальный эталон светлой темы,
   кабинет владельца. Утверждён 2026-07-07.
2. `docs/design/prototype-operator-v1.html` — визуальный эталон тёмной темы,
   PWA оператора (мастер сдачи итогов, плитки зон/активов, шторка ввода).
   Утверждён 2026-07-07.
3. `docs/design/prototype-owner-readings-v1.html` — «Показания по дням»
   (кабинет владельца, светлая тема): календарь + инлайн-панель дня (**не**
   bottom sheet — расхождение с общим правилом «детали сущности через шторку»,
   здесь панель дня встроена в поток страницы под календарём, потому что и
   календарь, и панель видны одновременно), карточка на зону-сдачу с цепочкой
   показаний, kebab-правка/удаление, заметка о блокировке. Утверждён
   2026-07-07.
4. Этот файл (`docs/design/design-system.md`) — токены/паттерны/компоненты,
   выведенные из всех прототипов.
5. `docs/spec/03-design-system.md` — остаётся источником истины по интерфейсным
   *правилам*, которые не показаны в статичных прототипах (навигация, границы
   применения владелец/оператор, наблюдения из референсов и т.д.).

**Новые паттерны из «Показания по дням»:**
- **Цепочка показания**: «пред. → тек.» + дельта числом (`+15`), опциональный
  кружок-бейдж «правка» (ⓘ) с tooltip «Изменено владельцем {дата} · было: N».
- **Заметка о блокировке**: серая плашка в карточке вместо kebab-действий,
  когда правка/удаление недоступны (см. `01-counters.md`).
- Kebab у заблокированной сдачи открывает тот же action-list, но пункты
  задизейблены + поясняющий текст сверху — не два разных компонента.

Известные расхождения между (1)/(2) и (3) на момент этого обновления перечислены
в конце файла, в разделе «Открытые противоречия» — они намеренно не устранены
молча.

## 1. Токены

Значения ниже взяты из `:root` прототипа. Колонка «Tailwind/CSS сейчас»
показывает, чему это соответствует в `src/app/globals.css` (проект на Tailwind v4
— конфигурация темы через `@theme`/CSS-переменные, **`tailwind.config.js`/`.ts`
в проекте нет** и не нужен; см. примечание в конце раздела).

| Токен прототипа | Значение (light) | Назначение | Tailwind/CSS сейчас |
|---|---|---|---|
| `--bg` | `#F6F7F5` | фон экрана (за карточками) | новое значение для `--surface-0` (было `#FBFBF9` в `docs/spec/03-design-system.md`) → класс `bg-surface-0` |
| `--card` | `#FFFFFF` | фон карточки | уже существующий `--card` → класс `bg-card` (без изменений) |
| `--ink` | `#1B1F1D` | основной текст | `--foreground` → класс `text-foreground` |
| `--ink-2` | `#5C6662` | вторичный текст (подписи, мета) | `--muted-foreground` → класс `text-muted-foreground` |
| `--ink-3` | `#9AA39F` | третичный текст (плейсхолдеры, «нет данных», неактивное) | **новой переменной не заводим** — выражается как `text-muted-foreground/70` (см. примечание ниже) |
| `--line` | `#E8EBE8` | граница карточек/строк/сетов | уже существующий `--border`/`--input` (light: `oklch(0.922 0 0)` ≈ `#E8E8E8`, практически совпадает) → класс `border-border` |
| `--accent` | `#0E8074` | акцентный цвет (primary) | тенантный `--primary` через `[data-accent="..."]` (см. §3 «Акцентная схема») |
| `--accent-ink` | `#0A5F56` | текст/иконки на акцентном фоне, ссылки | `--primary` в тёмном оттенке / `text-primary` (ссылки) |
| `--accent-soft` | `#E4F3F0` | мягкий фон чипов/статусов | `bg-primary/10` (opacity-модификатор, без нового токена) |
| `--warn` | `#B45309` | текст предупреждения | уже существующий `--warning-foreground`-подобный — использовать `--warning` через `text-warning` (см. примечание) |
| `--warn-soft` | `#FEF4E6` | фон чипа-предупреждения | `bg-warning/10` (уже используемый паттерн, см. `dashboard-home.tsx`) |
| `--danger` | `#C4372B` | деструктивный текст/иконки | уже существующий `--destructive` → `text-destructive` |
| `--danger-soft` | `#FBEDEB` | фон деструктивного пункта меню (hover) | `bg-destructive/10` |
| `--radius-lg` | `20px` | крупные карточки | **обновляет** `--radius-card` (было `1rem`/16px) → `1.25rem` |
| `--radius-md` | `14px` | кнопки, инпуты, bottom sheet контролы | **обновляет** `--radius-control` (было `0.75rem`/12px) → `0.875rem` |
| `--radius-lg` (sheet) | `24px` (верх шторки) | bottom sheet | уже существующий `--radius-block` (`1.5rem`/24px) — **совпадает**, без изменений |
| `--shadow-card` | `0 1px 2px rgba(27,31,29,.04), 0 8px 24px rgba(27,31,29,.05)` | тень карточки в покое | **обновляет** `--shadow-card-rest` (было на чистом чёрном `rgba(0,0,0,...)`, теперь тон в цвет `ink`) |
| `--shadow-sheet` | `0 -12px 40px rgba(27,31,29,.18)` | тень bottom sheet | **новый токен** `--shadow-sheet` (добавить рядом с `--shadow-floating`; `BottomSheet` компоненту нужно будет переключиться на него — код не тронут в этом заходе, см. финальный отчёт) |

**Важное отличие от прежнего описания «Визуальный язык»** (`docs/spec/03-design-system.md`):
там глубина карточек строилась **только тенью, «почти без бордюров»**. В
прототипе карточки **всегда имеют и тонкую границу `--line`, и мягкую тень**
одновременно. Прототип как визуальный эталон делает это новым каноном — старая
формулировка «почти без бордюров» в `03-design-system.md` устарела и не
исправлена в рамках Шага 3 (это визуальный принцип, а не пункт из явного списка
правок Шага 3) — см. «Открытые противоречия».

**Про `--ink-3` и «мягкие» фоны (`*-soft`)**: вместо заведения отдельной
CSS-переменной на каждый третичный/приглушённый оттенок, они выражаются через
opacity-модификатор Tailwind поверх уже существующего семантического цвета
(`text-muted-foreground/70`, `bg-primary/10`, `bg-warning/10`, `bg-destructive/10`).
В проекте уже используется этот приём (`dashboard-home.tsx`: `border-warning/40
bg-warning/10`) — решение развивает существующий паттерн, а не вводит новый.

**Про `tailwind.config`**: инструкция ссылалась на `theme.extend.colors` /
`borderRadius` / `boxShadow` в `tailwind.config` — в проекте такого файла нет,
это Tailwind v4 (см. `AGENTS.md`: «This is NOT the Next.js you know» — до
этого места дошло явно). Тема настраивается CSS-переменными и блоком `@theme
inline` прямо в `src/app/globals.css`. Таблица выше уже даёт мэппинг на реальный
механизм проекта вместо несуществующего конфига.

## 2. Типографика

Общая для всех интерфейсов (кабинет владельца и PWA оператора):

- Шрифт: **Inter** (как в прототипе) — **расхождение** с уже принятым и
  реализованным Onest (заменил Inter в ШАГ 2 редизайна, `next/font/google`,
  кириллица). Не меняю сам — см. «Открытые противоречия».
- Заголовок страницы: `26px / 800 / letter-spacing -0.02em` (прототип; в
  текущей реализации `.text-screen-title` — `28px/600` — расхождение в
  размере И жирности, см. «Открытые противоречия»).
- Заголовок секции/карточки: `17.5px/700` (card-title) и `11px/700
  uppercase letter-spacing .08em` (card-label) — новые уровни, отсутствовавшие
  в прежней типографической шкале (`text-section-title` был один `18px/600`).
- Тело: `14.5px/500` (row-title), `13.5px/400` (page-sub).
- Подпись/мета: `12–12.5px`, цвет `--ink-3`.
- **Все денежные и числовые значения**: `font-variant-numeric: tabular-nums`
  (класс `.num` в прототипе → Tailwind-класс `tabular-nums`, уже используется
  в проекте, без изменений).

## 3. Паттерны UI — обязательны для всех интерфейсов

Ниже — решения по открытым вопросам, подтверждённые пользователем 2026-07-07.

1. **Формы создания сущностей — только bottom sheet.** Инлайн-форм в потоке
   страницы быть не должно (это отменяет промежуточное решение «форма внизу
   страницы» из предыдущего захода правок — см. память проекта). Компонент:
   уже существующий `src/components/motion/bottom-sheet.tsx` (`BottomSheet`,
   framer-motion spring, drag-to-dismiss) — **не** shadcn `Sheet`/vaul `Drawer`,
   так как пружинный `BottomSheet` уже построен и это единственный экземпляр
   паттерна, которому надо следовать (второй такой же компонент заводить не
   нужно). Скруглённый верх `--radius-block` (24px, уже совпадает), ручка-полоска
   (`grabber`) — уже есть в `BottomSheet`.
2. **Действия над сущностью — только за кнопкой «···» (kebab)**, открывающей
   bottom sheet со списком действий. Никаких текстовых ссылок-действий прямо на
   карточке (отменяет инлайн-ссылки «Переименовать»/«Удалить», добавленные в
   предыдущем заходе правок на `/points`, `/operators`, `/zones/[id]` — требуется
   код-ревизия, см. финальный отчёт). Деструктивные пункты — в конце списка,
   цвет `--danger`/`text-destructive`. Удаление требует отдельного подтверждения
   (в прототипе это не показано явно внутри одного sheet — уточнить у
   пользователя форму подтверждения при реализации: второй sheet, или строка
   подтверждения над списком действий).
3. **Кнопка добавления** — пилл «+ Добавить» в шапке секции **или** пунктирная
   строка `add-inline` внутри карточки («+ Устройство/ссылка активации»,
   «+ Добавить актив»). `Button variant="outline"` (нейтральная светлая
   заливка), не тёмный `--ink`-пилл — запрос пользователя 2026-07-20: «везде
   по проекту чёрные кнопки надо заменить, на такие, как мы делали в
   Товарах» (там уже `variant="outline"`); `variant="dark"` удалён из
   `buttonVariants` как более не используемый нигде в проекте.
   Плавающего FAB нет — фиксируется явно (раньше в спеке `03-design-system.md`
   такого явного запрета не было; фиксируется этим документом впервые, не
   «уже было», см. «Открытые противоречия» насчёт текущей FAB-кнопки оператора).
4. **Статусы — чипы** (`.chip`): активен/активировано — `--accent-soft` фон +
   точка-индикатор; предупреждения («Тарифы не заданы») — `--warn-soft`.
   Маппинг на shadcn: `Badge` с кастомными классами фона/текста через токены
   (текущий `Badge` использует `default`/`secondary` варианты — понадобится
   вариант, использующий accent-soft/warn-soft; не менять код в этом заходе).
5. **Лимит тарифов (2 на зону)**: кнопка добавления не скрывается при
   достижении лимита, а показывается **задизейбленной** с текстом «Достигнут
   лимит: 2 тарифа» (`.add-inline:disabled`). Текущая реализация (`/zones/[id]`)
   форму просто не рендерит при `tariffs.length >= 2` — другое поведение,
   нужна код-правка (не сделана в этом заходе, только зафиксирована в
   `docs/spec/02-money.md`/`01-counters.md`, если там уместно — см. Шаг 3 ниже).
6. **Карточки**: radius 20px (`--radius-lg`), тонкая граница `--line` **и**
   мягкая тень одновременно (см. §1 про отличие от «Визуального языка»).
7. **Навигация**: без изменений относительно `docs/spec/03-design-system.md`
   — нижняя панель, максимум 5 вкладок + «Ещё»; в мастере сдачи итогов
   навигация скрыта.

**Framer-motion остаётся движком анимации** (пружины `PressableScale`,
`BottomSheet`, `StaggerList`) — CSS-переходы в HTML-прототипе (`transition`,
`cubic-bezier`) объясняются тем, что это статичный демо-файл без доступа к
framer-motion, не сигнал сменить движок. Подтверждено пользователем 2026-07-07.

**Акцентная схема остаётся настраиваемой** (5 пресетов на тенанта: зелёный по
умолчанию, синий/оранжевый/фиолетовый/teal, плюс коралловый — 6-й пресет,
`/settings` → `AccentPicker`). `--accent`/`--accent-ink` из прототипа — это
цвет пресета `"teal"`, а не единственный фиксированный акцент продукта.
Подтверждено пользователем 2026-07-07.

### Тёмная тема (PWA оператора)

Источник: `docs/design/prototype-operator-v1.html`, утверждён пользователем
2026-07-07 как визуальный эталон тёмной темы (аналогично тому, как
`prototype-owner-v2.html` — эталон светлой). Как и там, фиксированный
`--accent:#2BB3A3` прототипа — это цвет конкретного демо, а не единственный
акцент продукта: в реализации акцент по-прежнему активный пресет тенанта через
`[data-accent="..."].dark` (уже так и было для тёмной темы кабинета владельца,
это подтверждает то же самое, не новое решение).

| Токен прототипа | Значение (dark) | Назначение | Tailwind/CSS сейчас |
|---|---|---|---|
| `--bg` | `#141917` | фон экрана | `--background` (dark) → `bg-background` |
| `--card` | `#1D2421` | фон карточки | `--card` (dark) → `bg-card` |
| `--card-2` | `#232B28` | вторичная заливка (иконки-плашки, поля ввода, `--muted`) | `--muted`/`--secondary` (dark) → `bg-muted` |
| `--ink` | `#F1F4F2` | основной текст | `--foreground` (dark) → `text-foreground` |
| `--ink-2` | `#A6B0AB` | вторичный текст | `--muted-foreground` (dark) → `text-muted-foreground` |
| `--ink-3` | `#6E7A74` | третичный текст | без нового токена, как и в светлой теме — `text-muted-foreground/70` |
| `--line` | `#2B3330` | граница | `--border`/`--input` (dark) → `border-border` |
| `--ok` / `--warn` / `--danger` | `#3ECF8E` / `#E5A54B` / `#EF6A5E` | семантические цвета (не акцент) | `--success`/`--warning`/`--destructive` (dark) — раньше были placeholder-значения oklch, теперь заменены точным hex прототипа |
| `--radius-lg` / `--radius-md` | `20px` / `14px` | крупные/мелкие радиусы | уже совпадает с `--radius-card`/`--radius-control` — новых токенов не нужно |
| `--shadow-sheet` (dark) | `0 -12px 40px rgba(0,0,0,.5)` | тень bottom sheet | уже совпадает с текущим `--shadow-sheet` (dark) — без изменений |

**Паттерны, специфичные для PWA оператора** (кабинету владельца не нужны, в
`prototype-owner-v2.html` их не было):

1. **Плитка зоны/актива** (`.zone-tile`/`.asset-tile`, `.tile-grid`) — сетка
   2 колонки, карточка `bg-card border-border`, при выборе/заполнении —
   галочка-бейдж в углу (`accent`/`success`), у зоны дополнительно
   accent-soft фон + accent-граница в выбранном состоянии. Реализация:
   переиспользуют `TileIcon`/`AssetOrZoneIcon` (уже есть) для иконки/эмодзи не
   заводим — проект везде использует lucide-иконки через `iconKey`, а не
   emoji прототипа (то же решение, что раньше с framer-motion: демо-файл
   статичен и использует, что проще нарисовать вручную, это не сигнал менять
   существующий механизм иконок).
2. **Прогресс мастера** (`.wiz-top`/`.wiz-progress`/`.wiz-title`/`.wiz-sub`) —
   шапка шага (кнопка «назад» + «Шаг N из M»), тонкая полоса из сегментов
   (`bg-border`, пройденные — `bg-primary`), заголовок шага `24px/800`, подзаголовок
   `13.5px` `text-muted-foreground`.
3. **Шторка ввода показаний** (`.sheet` + `.field`) — уже `BottomSheet`
   (общий компонент), новое здесь — **живая дельта под полем**: заездов
   посчитано на лету (`text-primary`), с переходом через 9999→0 —
   `text-warning` и пометка «проверьте».
4. **Степпер** (`.stepper`, «Возвраты/тестовые пуски») — `−`/значение/`+`,
   `bg-muted` для кнопок, значение `tabular-nums`, без нового общего
   компонента — используется только этим экраном.
5. **Нижняя панель мастера** (`.wiz-bar`) — фиксирована снизу экрана,
   `bg-card/92` + `backdrop-blur`, «Назад» (outline) + «Далее» (primary,
   опционально со счётчиком заполнения справа, `12px/600 opacity-75`).

**Противоречие с уже принятым решением (см. «Открытые противоречия» ниже):**
прототип PWA оператора показывает кнопку «Сменить оператора» как **плавающую
пилюлю** (`position:absolute; right/bottom`) — а в редизайне кабинета
владельца 2026-07-07 было явно решено убрать FAB и сделать эту же кнопку
обычной строчной ссылкой в потоке страницы (см. пункт 6 в «Resolved in code»
выше). Решение при реализации: **оставить в потоке** (не `position:fixed`),
но перекрасить в стиль пилюли прототипа (`bg-card border-border rounded-full`,
а не текст-ссылка) — компромисс между двумя источниками истины, а не слепое
следование новому прототипу. Если нужно именно плавающее положение — скажите,
несложно поменять.

## 4. Соответствие паттернов компонентам shadcn/ui

| Паттерн прототипа | Компонент shadcn/ui в проекте |
|---|---|
| `.card` | `Card`/`CardContent` либо уже существующий `SpringCard` (`src/components/spring-card.tsx`) — предпочтителен `SpringCard`, он уже даёт нужный radius/shadow/hover-lift |
| `.chip` (статус) | `Badge` (нужен новый вариант под accent-soft/warn-soft, см. §3.4) |
| `.sheet` (bottom sheet) | `src/components/motion/bottom-sheet.tsx` (`BottomSheet`) — не shadcn `Sheet` |
| `.field input` | `Input` + `Label` (без изменений) |
| `.btn-primary` | `Button` (variant по умолчанию, использует `--primary`) |
| `.btn-add` | `Button variant="outline"` — нейтральная светлая заливка (не `--primary`, не тёмный `--ink`-пилл, см. §3.3) |
| `.kebab` | `Button` `variant="ghost"` `size="icon"`, круглый, иконка `MoreHorizontal` (lucide) |
| `.swatch` (цветовая метка) | нативный `<input type="color">`, уже используется в `/zones/[id]` — паттерн без изменений |

## 5. Общие компоненты

Переиспользуемые между кабинетом владельца и PWA оператора (различие — только
тема, `data-accent`/`.dark` через существующие провайдеры):

- карточка-листинг (`SpringCard` + содержимое строки);
- строка с kebab-действием (общий паттерн `divider-row` + `kebab`-кнопка);
- bottom sheet (`BottomSheet` — уже общий, `src/components/motion/`);
- чип статуса (`Badge` с accent-soft/warn-soft вариантом, см. §3.4/§4).

## Открытые противоречия (не исправлены молча)

См. также финальный отчёт в чате — здесь только те, что напрямую относятся к
токенам/типографике этого файла:

**Resolved in code 2026-07-07** (user said "Сделай дизайн проекта как в прототипе" — implement it, resolving these in the prototype's favor):

1. **Шрифт**: Inter now implemented (`src/app/layout.tsx`), replacing Onest. `docs/spec/03-design-system.md` still says Onest in its "Типографика"/"Визуальный язык" sections — **that spec text is now stale**, not updated as part of this pass (it's prose describing the old Airbnb-referenced look; this file and the actual code are the current source of truth).
2. **Заголовок экрана**: `.text-screen-title` now `26px/800/-0.02em`, matching the prototype exactly (`globals.css`).
3. **Радиус карточки/контролов**: `--radius-card`/`--radius-control` now `1.25rem`/`0.875rem` (20px/14px), matching the prototype.
4. **Тень vs граница**: `SpringCard` now renders `border border-border` together with `shadow-card-rest`, matching the prototype. The "почти без бордюров" line in `03-design-system.md`'s "Визуальный язык" is now stale prose, not corrected here (interface-description edits only touched the specific bullets listed in the original request).
5. **Фон страницы**: `--surface-0` now `#F6F7F5` in light mode, matching the prototype.
6. **Кнопка FAB**: removed. `/operator`'s "Сменить оператора" is now a plain in-flow link, not `fixed`.
7. **Действия на карточках**: `/points`, `/points/[id]`, `/zones/[id]`, `/operators` now use kebab (`KebabButton`) + `BottomSheet` action lists (`ActionSheetItem`) everywhere — the inline rename/delete text links from the prior pass are gone.
8. **Формы создания**: all create-forms (point, device, zone, tariff, asset, operator) now open in a `BottomSheet`, not inline in the page flow.

New shared components built for this: `src/components/kebab-menu.tsx` (`KebabButton`, `ActionSheetItem`), `src/components/status-chip.tsx` (`StatusChip`), `src/components/tile-icon.tsx` (`TileIcon`), `src/components/icon-picker.tsx`'s new `IconPickerSheet` (controlled variant for kebab-driven icon changes). `Button` got a new `variant="dark"` for the prototype's "+ Добавить" pill (`.btn-add` — deliberately neutral chrome, not `--primary`). `/money` was also brought in line (hero+split business card, bottom-sheet change-fund form, muted zero balances) even though it wasn't explicitly named in the original 5-step request, since it's one of the prototype's five screens.

Still not done: `docs/spec/03-design-system.md`'s prose (Onest, "почти без бордюров", literal shadow/radius numbers under "Визуальный язык") describes the pre-prototype look and hasn't been rewritten — it's now superseded by this file and the actual code, but left as historical record rather than edited, since that would go beyond "add the five specific interface-behavior bullets" from the original request. Flag if you want it brought current too.
