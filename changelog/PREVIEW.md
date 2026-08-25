# История изменений — черновик на вычитку

_Даты в публикации не выводятся. Служебная дата дня показана здесь только для
сверки с историей коммитов. Живой вид страницы — `/changelog` в приложении._

## 1.22.1  <sub>(2026-08-25)</sub>

**Исправлено**

- Выбор точки: удалённая точка, оставшаяся в памяти браузера, больше не приводит к пустому экрану.
  <br>_Location picker: a deleted location left in browser storage no longer leaves you with a blank screen._


## 1.22.0  <sub>(2026-08-23)</sub>

**Новое**

- Настройки: тумблер «Доступ техподдержки» под карточкой плана — владелец сам решает, когда открыть кабинет для помощи.
  <br>_Settings: a Support access toggle under the plan card — the owner decides when to open the account for assistance._

**Улучшено**

- Счётчики: идущие браслеты с тарифом «За вход» сразу видны в выручке на Главной, не дожидаясь окончания.
  <br>_Counters: wristbands still running on an entry-fee rate now show up in the home-screen revenue right away, without waiting for them to finish._
- Зоны: у «Прибываний» пункт меню назван «Название, цвет и тариф» — по тому, что он на самом деле открывает.
  <br>_Zones: for Stays, the menu item is now called Name, colour and rate — matching what it actually opens._

**Исправлено**

- Счётчики: расходы и «Разница» учитывают инкассацию, сделанную посреди дня.
  <br>_Counters: expenses and the Difference figure now account for a collection made in the middle of the day._
- Деньги: «Разница» на Главной считает расходы так же, как остальные экраны.
  <br>_Money: the Difference figure on the home screen counts expenses the same way every other screen does._
- Деньги: раздел открывается и в периодах, где не было продаж билетов.
  <br>_Money: the section opens in periods with no ticket sales as well._
- Инкассации: старую запись снова можно поправить — зачтённый аванс больше не блокирует правку.
  <br>_Collections: an earlier record can be edited again — a settled advance no longer blocks the change._
- Оформление: тёмная тема приложения сотрудника больше не влияет на кабинет владельца.
  <br>_Appearance: the employee app's dark theme no longer bleeds into the owner's account._


## 1.21.0  <sub>(2026-08-22)</sub>

**Новое**

- Расходы: сотрудник может поправить свой расход, а сообщение в Telegram обновится следом.
  <br>_Expenses: an employee can edit their own expense, and the Telegram message updates to match._

**Улучшено**

- Прибывания: таймер на тайле масштабируется по ширине плитки и читается на любом экране.
  <br>_Stays: the timer on a tile scales to the tile's width and stays readable on any screen._


## 1.20.2  <sub>(2026-08-19)</sub>

**Улучшено**

- Язык сотрудника задаёт владелец, а экран входа устройства показывается на языке компании.
  <br>_The owner sets each employee's language, and the device login screen appears in the company's language._
- Памятка «Как работать» переведена на 14 языков.
  <br>_The How it works guide is now available in 14 languages._


## 1.20.1  <sub>(2026-08-17)</sub>

**Улучшено**

- Списки держат порядок, заданный владельцем, — стрелки перестановки работают предсказуемо.
  <br>_Lists keep the order the owner set, and the reordering arrows behave predictably._
- В общих списках приложения сотрудника видно, кто внёс запись.
  <br>_Shared lists in the employee app show who created each record._
- Сообщения об инкассации перечисляют зоны по строкам, точка — отдельной строкой.
  <br>_Collection messages list zones line by line, with the location on its own line._


## 1.20.0  <sub>(2026-08-16)</sub>

**Новое**

- Telegram: расходы и инкассации приходят отдельными сообщениями; правка переписывает уже отправленное, а удаление записи убирает сообщение.
  <br>_Telegram: expenses and collections arrive as their own messages; an edit rewrites the message already sent, and deleting the record removes it._
- «Как работать»: памятка собирается под каждого сотрудника из его настроек и доступа.
  <br>_How it works: the guide is assembled for each employee from their own settings and access._
- Реестры: продажи, расходы и начисления собраны единым списком с фильтрами и поиском.
  <br>_Registers: sales, expenses and payouts are gathered into one list with filters and search._

**Улучшено**

- Итоги дня: чистый остаток наличными и ожидаемая касса Товаров ещё до сдачи.
  <br>_Day summary: the net cash on hand, plus the expected Goods takings before they are handed over._
- Правки, сделанные владельцем, помечены знаком ♛ во всех сообщениях и реестрах.
  <br>_Changes made by the owner are marked with ♛ across messages and registers._
- Отчёты: график «Динамика» строится и по произвольному периоду.
  <br>_Reports: the Dynamics chart is drawn for custom periods too._


## 1.19.0  <sub>(2026-08-15)</sub>

**Новое**

- Кабинет: подсказки ⓘ у показателей — что именно считает каждая цифра.
  <br>_Owner account: ⓘ hints next to the figures explain exactly what each number counts._
- Расходы: сумма учитывается в момент ввода, а не откладывается до сдачи итогов.
  <br>_Expenses: the amount is counted the moment it is entered, instead of waiting for the results submission._
- Лендинг: кнопка «Группа в Telegram» подтягивается из уже подключённой группы.
  <br>_Landing page: the Telegram group button is taken from the group already connected._

**Улучшено**

- Новый логотип во всех иконках приложения.
  <br>_A new logo across every app icon._
- Лендинг: фотографии зон и разметка страницы приведены к требованиям поисковиков.
  <br>_Landing page: zone photos and page markup now meet search engines' requirements._


## 1.18.1  <sub>(2026-08-14)</sub>

**Улучшено**

- Рабочее время: премию сотруднику можно поправить и убрать.
  <br>_Work time: an employee bonus can be edited or removed._
- Клиенты: владелец снова может пополнить баланс произвольной суммой.
  <br>_Clients: the owner can top up a balance with any amount again._

**Исправлено**

- Инкассации: правка авансовой инкассации больше не занижает остатки зон.
  <br>_Collections: editing an advance collection no longer understates the zone balances._
- Переход из кабинета на сайт сохраняет вход — владелец не превращается в гостя.
  <br>_Moving from the account to the website keeps you signed in — the owner is no longer treated as a guest._


## 1.18.0  <sub>(2026-08-13)</sub>

**Новое**

- Рабочее время: владелец выбирает, что сотрудник может взять из кассы сам — аванс, премию или ничего.
  <br>_Work time: the owner chooses what an employee may take from the till themselves — an advance, a bonus, or nothing._
- Клиенты: клиент узнаётся по номеру телефона, даже если он записан с другим кодом страны, а касса подсказывает похожие номера.
  <br>_Clients: a client is recognised by phone number even when it was saved with a different country code, and the till suggests close matches._
- Устройства: экран не гаснет там, где идут таймеры, и во время сдачи итогов.
  <br>_Devices: the screen stays awake where timers are running and during a results submission._
- Устройства: планшет сам перезагружает приложение, когда выходит обновление.
  <br>_Devices: the tablet reloads the app on its own when an update ships._
- Инкассация: слип показывает, из чего сложилась сумма.
  <br>_Collections: the slip shows what the amount is made up of._

**Улучшено**

- Скорость: вход, настройки и длинные списки открываются заметно быстрее.
  <br>_Speed: signing in, settings and long lists open noticeably faster._
- Настройки: часовой пояс выбирается для любой страны, а не только для стран языков RentOS.
  <br>_Settings: the time zone can be chosen for any country, not just the ones behind RentOS's languages._
- Точки: потерянную привязку устройства можно вернуть, не заводя новое.
  <br>_Locations: a lost device binding can be restored without registering a new device._
- Безопасность: проверки прав усилены по итогам аудита — отозванная сессия больше ничего не меняет.
  <br>_Security: permission checks strengthened after an audit — a revoked session can no longer change anything._


## 1.17.1  <sub>(2026-08-10)</sub>

**Улучшено**

- Язык, выбранный на сайте, сохраняется при переходе в кабинет.
  <br>_The language chosen on the website carries over into the account._
- Подписка: «Управлять подпиской» открывает страницу цен на языке владельца.
  <br>_Subscription: Manage subscription opens the pricing page in the owner's language._
- Брошенные бесплатные кабинеты удаляются сами, с предупреждениями заранее.
  <br>_Abandoned free accounts are removed automatically, with warnings sent in advance._

**Исправлено**

- Оплата с другого адреса больше не заводит второй, пустой кабинет.
  <br>_Paying from a different email address no longer creates a second, empty account._


## 1.17.0  <sub>(2026-08-08)</sub>

**Новое**

- Единый вход: переход из кабинета на сайт и обратно без повторного ввода пароля.
  <br>_Single sign-on: move between the account and the website without entering your password again._
- Покупка на сайте сразу создаёт кабинет — ждать ручной привязки не нужно.
  <br>_A purchase on the website creates the account straight away — no manual linking to wait for._

**Улучшено**

- Письма о входе и восстановлении приходят на языке владельца.
  <br>_Sign-in and recovery emails arrive in the owner's language._
- Вход: обычная опечатка в ПИН-коде больше не запирает устройство надолго.
  <br>_Sign-in: a simple typo in the PIN no longer locks the device out for long._
- Итоги по дням: календарь на большом экране не растягивается на всю карточку.
  <br>_Daily results: on a wide screen the calendar no longer stretches across the whole card._


## 1.16.1  <sub>(2026-08-06)</sub>

**Улучшено**

- Бизнес-день: граница дня задаётся тумблером, и все экраны считают по ней.
  <br>_Business day: the day boundary is set with a toggle, and every screen counts by it._
- Касса за день: конец дня определяется закрытым рабочим временем, а не покрытием зон.
  <br>_Daily takings: the end of the day is determined by closed working time rather than zone coverage._
- Рабочее время: допуск начала смены выбирается из списка длительностей.
  <br>_Work time: the early-start allowance is picked from a list of durations._

**Исправлено**

- Сводка кассы приходит и после ручного ввода смены, с правильной датой при поздней границе дня.
  <br>_The takings summary also arrives after a manually entered shift, with the right date when the day boundary is late._


## 1.16.0  <sub>(2026-08-04)</sub>

**Новое**

- Сдача итогов: слепой ввод кассы — сотрудник вводит свою сумму, не видя расчётную. Включается владельцем.
  <br>_Results submission: blind cash entry — the employee enters their own figure without seeing the calculated one. Enabled by the owner._
- Итоги дня: длинные списки сворачиваются, и видно, кто кого обслуживал.
  <br>_Day summary: long lists collapse, and it is clear who served whom._

**Улучшено**

- Сводка Прибываний: оплаченное время и разбивка по способам оплаты.
  <br>_Stays summary: paid time and a breakdown by payment method._
- Инкассация по зоне вперёд: минус в остатке зоны подписан и объяснён.
  <br>_Collecting a zone in advance: the negative zone balance is labelled and explained._


## 1.15.1  <sub>(2026-08-03)</sub>

**Улучшено**

- Клиенты: список можно импортировать при переезде с другого учёта.
  <br>_Clients: the list can be imported when moving over from other software._
- Рабочее время: перенос остатка показывается только в своём месяце.
  <br>_Work time: a carried-over balance is shown only in the month it belongs to._
- Реестр инкассаций: видно, кто забрал деньги и сколько за один раз.
  <br>_Collection register: it shows who took the money and how much at a time._

**Исправлено**

- Периоды во всех отчётах считаются в часовом поясе компании.
  <br>_Periods in every report are counted in the company's time zone._


## 1.15.0  <sub>(2026-07-31)</sub>

**Новое**

- Товары: отложенные заказы — тайлы столов, докупка тем же тапом, оплата или отмена позже.
  <br>_Goods: held orders — table tiles, add more with the same tap, pay or cancel later._
- Товары: карточка сверок в «Итогах дня» и сдача кассы сотрудником.
  <br>_Goods: a reconciliation card in the day summary, and cash handover by the employee._
- Товары и Прибывания: к заказу привязывается клиент.
  <br>_Goods and Stays: an order can be tied to a client._

**Улучшено**

- Лендинг и Инструктажи: если сохранить не удалось, об этом говорится, а не проходит молча.
  <br>_Landing page and Instructions: when saving fails you are told, instead of it passing silently._


## 1.14.1  <sub>(2026-07-29)</sub>

**Улучшено**

- Точки: владелец привязывает текущее устройство прямо из кабинета, без ссылки и QR.
  <br>_Locations: the owner binds the current device straight from the account, with no link or QR code._
- Вход: отдельные кнопки «Войти как Владелец» и «Войти как Сотрудник».
  <br>_Sign-in: separate Sign in as owner and Sign in as employee buttons._
- Прибывания: таймер и сумма на тайле крупнее и подстраиваются под ширину экрана.
  <br>_Stays: the timer and amount on a tile are larger and adapt to the screen width._


## 1.14.0  <sub>(2026-07-28)</sub>

**Новое**

- Внешний вид: логотип компании водяным знаком в приложении сотрудника.
  <br>_Appearance: the company logo as a watermark in the employee app._
- Внешний вид: фоновые эффекты — волны, частицы, гиперпространство, свечение и блик.
  <br>_Appearance: background effects — waves, particles, hyperspace, glow and shine._
- Клиенты: сводка «всего / подключено / с балансом» над списком и экспорт в Excel.
  <br>_Clients: a total / connected / with balance summary above the list, plus export to Excel._

**Улучшено**

- Крупные суммы подстраиваются под ширину экрана и не разъезжаются между собой.
  <br>_Large amounts adapt to the screen width and stay aligned with one another._
- Билеты и Товары: длинные названия помещаются в тайл в две строки.
  <br>_Tickets and Goods: long names fit onto a tile across two lines._
- Пуски: тарифы с таймером — та же механика «За вход», что у Прибываний.
  <br>_Launches: timed rates — the same entry-fee mechanics as in Stays._


## 1.13.0  <sub>(2026-07-27)</sub>

**Новое**

- Оплата: сумма делится между наличными, безналом и балансом в любой пропорции.
  <br>_Payment: an amount can be split between cash, card and balance in any proportion._
- Счётчики: показания можно набирать тапами по сеансам вместо ручного ввода.
  <br>_Counters: readings can be tapped in session by session instead of typed._
- Прибывания: несколько именованных тарифов на «За вход» и «По факту».
  <br>_Stays: several named rates for entry-fee and pay-as-you-go pricing._
- Прибывания: округление суммы «По факту» до целой единицы, тумблером зоны.
  <br>_Stays: pay-as-you-go amounts can be rounded to whole units, per zone._
- Онбординг: новый владелец проходит первичную настройку по шагам.
  <br>_Onboarding: a new owner is walked through the initial setup step by step._

**Улучшено**

- Активы: тайл окрашен градиентом по своей цветовой метке во всех разделах.
  <br>_Assets: a tile is tinted by its colour tag across every screen._
- Безопасность: уточнены права на денежные операции и правку записей.
  <br>_Security: permissions for money operations and record edits have been tightened._


## 1.12.0  <sub>(2026-07-25)</sub>

**Новое**

- Расходы: сотрудник фиксирует расход сразу, не дожидаясь сдачи итогов.
  <br>_Expenses: an employee records an expense immediately, without waiting for the results submission._

**Улучшено**

- Сводки: отправленное в Telegram сообщение правится задним числом, а не дублируется.
  <br>_Summaries: a message already sent to Telegram is edited in place rather than duplicated._
- Абонементы: выручка признаётся при пополнении баланса, а не при трате.
  <br>_Subscriptions: revenue is recognised when the balance is topped up, not when it is spent._
- Деньги: прибыль считается за вычетом авансов и премий.
  <br>_Money: profit is calculated net of advances and bonuses._
- Отчёты: раздел «Сотрудники» показывает заработок за период — ставку вместе с премиями.
  <br>_Reports: the Employees section shows earnings for the period — pay together with bonuses._
- Сдача итогов: шаг «Расходы» не показывается, когда расходов нет.
  <br>_Results submission: the Expenses step is skipped when there are none._


## 1.11.0  <sub>(2026-07-24)</sub>

**Новое**

- Клиенты: публичная группа в Telegram — новые тарифы и товары объявляются в ней сами.
  <br>_Clients: a public Telegram group — new rates and goods are announced there automatically._
- Счётчики: у сотрудника появился журнал возвратов и тестовых прогонов и списание с баланса.
  <br>_Counters: the employee now has a log of refunds and test runs, and can charge a client's balance._

**Улучшено**

- «Разница» не тревожит значком, когда разрыв целиком объясняется оплатой с баланса.
  <br>_The Difference figure stops flagging a gap that is fully explained by balance payments._
- Рассылка клиентам обращается по имени.
  <br>_Client broadcasts address people by name._
- Безопасность: усилены ограничения на подбор ПИН-кодов и паролей.
  <br>_Security: stronger limits on guessing PINs and passwords._


## 1.10.1  <sub>(2026-07-23)</sub>

**Улучшено**

- Реестр инкассаций: видно комментарий, авансовые инкассации и то, что сотрудник взял себе.
  <br>_Collection register: comments, advance collections and what the employee took for themselves are all visible._
- Остатки по зонам: Абонементы и Товары показываются всегда, когда модули включены.
  <br>_Zone balances: Subscriptions and Goods are always shown when those modules are on._
- Аванс и премия сотрудника разносятся по зонам сразу, а не на следующей инкассации.
  <br>_An employee's advance or bonus is spread across zones straight away, not at the next collection._
- Отчёты: границы периодов считаются по часовому поясу компании.
  <br>_Reports: period boundaries are counted in the company's time zone._
- Безопасность: сплошная проверка расчётов и прав доступа — данные компании доступны только её людям.
  <br>_Security: a full review of calculations and access rights — a company's data is available only to its own people._


## 1.10.0  <sub>(2026-07-22)</sub>

**Новое**

- Клиенты: Telegram-бот показывает клиенту его баланс — достаточно поделиться номером телефона.
  <br>_Clients: a Telegram bot shows clients their balance — sharing a phone number is enough._
- Клиенты: QR подключения бота прямо на карточке клиента.
  <br>_Clients: the bot's connection QR code sits right on the client card._
- Клиенты: владелец может отправить сообщение всем подключённым клиентам, в том числе с картинкой.
  <br>_Clients: the owner can message every connected client, with an image if needed._
- Telegram: команда /kassa показывает кассу с разбивкой по способам оплаты.
  <br>_Telegram: the /kassa command shows the takings broken down by payment method._


## 1.9.1  <sub>(2026-07-22)</sub>

**Улучшено**

- Точки, зоны, активы, сотрудники и товары включаются и выключаются одним тапом.
  <br>_Locations, zones, assets, employees and goods are switched on and off with a single tap._
- Настройки: Инструктажи, Задачи, Лендинг, Товары и Клиентов можно отключить, если они не нужны.
  <br>_Settings: Instructions, Tasks, Landing page, Goods and Clients can be turned off if you do not need them._
- Владелец отмечен единой иконкой-короной вместо подписи.
  <br>_The owner is marked with a single crown icon instead of a text label._
- Печать: тихая печать на Windows настраивается через реестр и запускается вместе с системой.
  <br>_Printing: silent printing on Windows is configured through the registry and starts with the system._


## 1.9.0  <sub>(2026-07-21)</sub>

**Новое**

- Билеты: продажа заказами с несколькими билетами, гашение и срок жизни, аннулирование поштучно или всем заказом.
  <br>_Tickets: sell orders containing several tickets, with redemption, expiry, and voiding one by one or by whole order._
- Билеты: экран продажи и заказов в приложении сотрудника, печать всех билетов заказа одной кнопкой.
  <br>_Tickets: a sales and orders screen in the employee app, printing every ticket in an order with one button._

**Улучшено**

- Билеты: номер заказа выделен акцентным цветом везде, где встречается.
  <br>_Tickets: the order number is highlighted in the accent colour wherever it appears._


## 1.8.0  <sub>(2026-07-20)</sub>

**Новое**

- Печать: квитанции на термопринтер шириной 58 мм, с предпросмотром в натуральную величину.
  <br>_Printing: receipts for a 58 mm thermal printer, with a life-size preview._
- Звук подтверждения при сохранении и при учёте пуска.
  <br>_A confirmation sound when something is saved and when a launch is recorded._

**Улучшено**

- Деньги и Отчёты: способы оплаты помечены иконками.
  <br>_Money and Reports: payment methods are marked with icons._
- Отчёты: период День / Неделя / Месяц / Год / Произвольный, как в остальных разделах.
  <br>_Reports: Day / Week / Month / Year / Custom periods, matching the rest of the app._
- Интерфейс: индикатор загрузки при переходах и заглушки на тяжёлых экранах.
  <br>_Interface: a loading indicator on navigation and placeholders on heavy screens._


## 1.7.0  <sub>(2026-07-19)</sub>

**Новое**

- Товары: каталог, продажа сотрудником, мягкие остатки и ревизия одним экраном.
  <br>_Goods: a catalogue, sales by the employee, soft stock levels and a stocktake on a single screen._
- Счётчики: оплата балансом клиента, включается тумблером в настройках.
  <br>_Counters: payment from a client's balance, enabled with a toggle in settings._

**Улучшено**

- Итоги дня: «Фактическая касса» — наличные, безнал и баланс одной суммой.
  <br>_Day summary: Actual takings — cash, card and balance as one figure._
- Итоги дня: видно, из чего складывается разрыв между расчётной и чистой выручкой.
  <br>_Day summary: it is clear what makes up the gap between calculated and net revenue._


## 1.6.0  <sub>(2026-07-18)</sub>

**Новое**

- Абонементы: планы пополнения, кошелёк клиента по номеру телефона, оплата покупок балансом.
  <br>_Subscriptions: top-up plans, a client wallet keyed to a phone number, and paying for purchases from the balance._
- Абонементы: карточка клиента с историей операций и поиском по списку.
  <br>_Subscriptions: a client card with transaction history and search across the list._
- Деньги: раздел «Итоги по дням».
  <br>_Money: a Daily results section._

**Улучшено**

- Отчёты: выручка с баланса отдельной строкой рядом с наличными и безналом.
  <br>_Reports: balance revenue on its own line next to cash and card._


## 1.5.0  <sub>(2026-07-17)</sub>

**Новое**

- Прибывания: пуски в реальном времени — старт и стоп в один-два тапа, живой таймер, свой тариф с историей у каждого актива.
  <br>_Stays: launches in real time — start and stop in one or two taps, a live timer, and each asset with its own rate and rate history._
- Прибывания: экран «Сейчас на точке» в кабинете и список пусков с правкой времени и аннулированием.
  <br>_Stays: a Currently on site screen in the owner's account, plus a list of launches with time editing and voiding._
- Пуски: учёт тапом по активу вместо ручного ввода — замена бумажной тетрадки.
  <br>_Launches: recorded by tapping the asset instead of typing — a replacement for the paper tally book._


## 1.4.0  <sub>(2026-07-16)</sub>

**Новое**

- Деньги: аванс и премия берутся из кассы по понятному правилу и разносятся по зонам.
  <br>_Money: advances and bonuses are taken from the till by a clear rule and spread across zones._
- Зоны и активы: деактивация на ремонт — точка, зона или актив выключаются каскадом.
  <br>_Zones and assets: deactivation for maintenance — a location, zone or asset switches off in a cascade._
- Отчёты и Деньги: фильтр по точке, включая сводный режим «Все точки».
  <br>_Reports and Money: a location filter, including an All locations roll-up._
- Отчёты: тепловая карта дней и график выручки и прибыли.
  <br>_Reports: a heat map of days and a revenue-and-profit chart._
- Интерфейс на итальянском языке.
  <br>_The interface is available in Italian._

**Улучшено**

- Сводки: компактный формат для Telegram — короткие подписи вместо полных слов.
  <br>_Summaries: a compact Telegram format with short labels instead of full words._


## 1.3.0  <sub>(2026-07-15)</sub>

**Новое**

- Деньги: суммы во всей системе печатаются в валюте компании единым форматом.
  <br>_Money: amounts are shown in the company's currency in one consistent format throughout._
- Деньги: инкассация по зоне и общая — и у владельца, и у сотрудника; реестр объединён с остатками.
  <br>_Money: collections per zone and in total, for both owner and employee; the register is merged with the balances view._
- Деньги: реестр расходов с категориями.
  <br>_Money: an expense register with categories._
- Главная: карточка «Разница» между расчётной выручкой и фактической кассой.
  <br>_Home: a Difference card between calculated revenue and actual takings._
- Внешний вид: фон приложения из пресетов и переключатель светлой и тёмной темы.
  <br>_Appearance: preset app backgrounds and a light/dark theme switch._

**Улучшено**

- Отчёты: период выбирается календарём, включая помесячную сетку года.
  <br>_Reports: the period is chosen from a calendar, including a month grid for the year._


## 1.2.0  <sub>(2026-07-14)</sub>

**Новое**

- Точки: устройство привязывается к точке по QR-коду, список обновляется сам после активации.
  <br>_Locations: a device is bound to a location by QR code, and the list refreshes itself once it is activated._
- Счётчики: начальные показания при калибровке — актив можно завести в середине месяца.
  <br>_Counters: starting readings at calibration — an asset can be added mid-month._
- Рабочее время: открытую смену можно поправить, не закрывая её.
  <br>_Work time: an open shift can be edited without closing it._
- Задачи: push-уведомление о новой задаче.
  <br>_Tasks: a push notification when a new task appears._

**Улучшено**

- Интерфейс: единый стиль кнопок, тумблеров и загрузки файлов по всему кабинету.
  <br>_Interface: one consistent style for buttons, toggles and file uploads across the account._


## 1.1.0  <sub>(2026-07-13)</sub>

**Новое**

- Лендинг: публичная страница компании по короткому адресу — зоны, фотографии и рассказ о себе.
  <br>_Landing page: a public company page at a short address — zones, photos and your own story._
- Лендинг: редактор с оформлением текста для описаний зон и раздела «О нас».
  <br>_Landing page: a formatting editor for zone descriptions and the About section._
- Лендинг: чеклист SEO в кабинете и подтверждение прав на сайт для поисковиков.
  <br>_Landing page: an SEO checklist in the account and site-ownership verification for search engines._


## 1.0.0  <sub>(2026-07-12)</sub>

**Новое**

- Счётчики: зоны, активы и тарифы, мастер сдачи итогов с расчётом выручки.
  <br>_Counters: zones, assets and rates, with a guided results submission that calculates revenue._
- Деньги: единый журнал операций, кассы точек и инкассации.
  <br>_Money: a single operations journal, per-location tills and collections._
- Рабочее время: смены, ставки, авансы и премии, скользящий баланс сотрудника.
  <br>_Work time: shifts, pay rates, advances and bonuses, and a running employee balance._
- Задачи: доска поручений по точкам с тремя статусами.
  <br>_Tasks: a board of assignments by location with three statuses._
- Инструктажи: инструкции с версиями, подписание по ссылке без входа, журнал ознакомлений.
  <br>_Instructions: versioned documents, signing by link without logging in, and an acknowledgement log._
- Приложение сотрудника ставится на устройство как PWA, а сдача итогов доживает до сети, если связь пропала.
  <br>_The employee app installs on a device as a PWA, and a results submission survives until the connection is back._
- Сводки в Telegram и на почту, push-уведомления владельцу.
  <br>_Telegram and email summaries, plus push notifications for the owner._
- Интерфейс на 14 языках, часовой пояс — свой у каждой компании.
  <br>_The interface in 14 languages, with each company setting its own time zone._

