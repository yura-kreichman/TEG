import type { Locale } from "@/lib/locales";
import { ALL_LOCALES } from "@/lib/locales";

// Локализация КЛИЕНТСКИХ сообщений бота (запрос пользователя 2026-07-22/23:
// "язык ответов бота должен определяться сам... на том языке, которые у нас
// есть, если нет — на английском") — переиспользует ровно тот же набор из 15
// языков, что и весь остальной проект (src/lib/locales.ts), НЕ отдельный
// список. Источник языка клиента — Telegram-нативное поле
// message.from.language_code (IETF-тег интерфейса аккаунта, не текста
// сообщения) для живых ответов; для проактивных пушей (изменение баланса,
// напоминание об истечении билетов), где нет живого апдейта, язык берётся из
// ClientTelegramLink.language — сохраняется один раз при первой проверке
// контакта (см. вебхук). Сообщения Владельцу/Сотруднику (групповые команды,
// привязка сводок) в этот словарь НЕ входят — те остаются на русском, тот же
// принцип, что уже действует в проекте для прочих бот-сообщений этой группы.
export function pickBotLang(languageCode?: string | null): Locale {
  const code = languageCode?.toLowerCase().split("-")[0];
  return (ALL_LOCALES as string[]).includes(code ?? "") ? (code as Locale) : "en";
}

// Персональное приветствие первой строкой (запрос пользователя 2026-07-23:
// "Привет, Юрий" вместо безликого отчёта) — берём только имя (первое слово),
// не всё wallet.name целиком: Сотрудник иногда вписывает "Юрий Крейчман"
// (имя+фамилия), а обращение "Привет, Юрий Крейчман!" звучит казённо.
export function greetingLine(clientName: string | null, s: BotStringSet): string {
  const firstName = clientName?.trim().split(/\s+/)[0];
  return firstName ? s.greetingWithName(firstName) : s.greetingGeneric;
}

export interface BotStringSet {
  greetingWithName: (firstName: string) => string;
  greetingGeneric: string;
  shareButton: string;
  startHintGeneric: string;
  startHintTenant: (name: string) => string;
  linkInvalid: string;
  notFoundGeneric: (phone: string) => string;
  notFoundTenant: (phone: string, name: string) => string;
  yourBalance: string;
  balanceWord: string;
  recentOps: string;
  openOrders: string;
  ticketsWord: string;
  typeTopup: string;
  typeSpend: string;
  typeRefund: string;
  typeAdjustment: string;
  ticketOrderPrefix: string;
  orderExpiringSoon: (orderNumber: number) => string;
}

export const BOT_STRINGS: Record<Locale, BotStringSet> = {
  ru: {
    greetingWithName: (n) => `Привет, ${n}!`,
    greetingGeneric: "Здравствуйте!",
    shareButton: "📱 Поделиться номером",
    startHintGeneric: "Чтобы узнать баланс, поделитесь своим номером телефона — тем же, что вы называли на точке проката.",
    startHintTenant: (name) =>
      `Чтобы узнать баланс у «${name}», поделитесь своим номером телефона — тем же, что вы называли на точке.`,
    linkInvalid: "Ссылка недействительна",
    notFoundGeneric: (phone) => `Клиент с номером ${phone} не найден ни у одного проката`,
    notFoundTenant: (phone, name) => `Клиент с номером ${phone} не найден у «${name}»`,
    yourBalance: "Ваш баланс",
    balanceWord: "Баланс",
    recentOps: "Последние операции",
    openOrders: "Неиспользованные заказы",
    ticketsWord: "билет(ов)",
    typeTopup: "Пополнение",
    typeSpend: "Списание",
    typeRefund: "Возврат",
    typeAdjustment: "Начисление",
    ticketOrderPrefix: "Билеты",
    orderExpiringSoon: (n) => `Ваш заказ №${n} скоро истекает — успейте использовать билеты.`,
  },
  en: {
    greetingWithName: (n) => `Hi, ${n}!`,
    greetingGeneric: "Hello!",
    shareButton: "📱 Share phone number",
    startHintGeneric: "To check your balance, share your phone number — the same one you gave at the rental point.",
    startHintTenant: (name) =>
      `To check your balance at "${name}", share your phone number — the same one you gave at the point.`,
    linkInvalid: "This link is no longer valid",
    notFoundGeneric: (phone) => `No client found with number ${phone}`,
    notFoundTenant: (phone, name) => `No client found with number ${phone} at "${name}"`,
    yourBalance: "Your balance",
    balanceWord: "Balance",
    recentOps: "Recent transactions",
    openOrders: "Unused orders",
    ticketsWord: "ticket(s)",
    typeTopup: "Top-up",
    typeSpend: "Payment",
    typeRefund: "Refund",
    typeAdjustment: "Adjustment",
    ticketOrderPrefix: "Tickets",
    orderExpiringSoon: (n) => `Your order #${n} is expiring soon — use your tickets in time.`,
  },
  uk: {
    greetingWithName: (n) => `Привіт, ${n}!`,
    greetingGeneric: "Вітаємо!",
    shareButton: "📱 Поділитися номером",
    startHintGeneric: "Щоб дізнатися баланс, поділіться своїм номером телефону — тим самим, що ви називали на точці прокату.",
    startHintTenant: (name) =>
      `Щоб дізнатися баланс у «${name}», поділіться своїм номером телефону — тим самим, що ви називали на точці.`,
    linkInvalid: "Посилання недійсне",
    notFoundGeneric: (phone) => `Клієнта з номером ${phone} не знайдено в жодному прокаті`,
    notFoundTenant: (phone, name) => `Клієнта з номером ${phone} не знайдено в «${name}»`,
    yourBalance: "Ваш баланс",
    balanceWord: "Баланс",
    recentOps: "Останні операції",
    openOrders: "Невикористані замовлення",
    ticketsWord: "квиток(ів)",
    typeTopup: "Поповнення",
    typeSpend: "Списання",
    typeRefund: "Повернення",
    typeAdjustment: "Нарахування",
    ticketOrderPrefix: "Квитки",
    orderExpiringSoon: (n) => `Ваше замовлення №${n} скоро закінчується — встигніть скористатися квитками.`,
  },
  ro: {
    greetingWithName: (n) => `Salut, ${n}!`,
    greetingGeneric: "Bună ziua!",
    shareButton: "📱 Trimite numărul de telefon",
    startHintGeneric: "Pentru a verifica soldul, trimiteți numărul dvs. de telefon — același pe care l-ați dat la punctul de închiriere.",
    startHintTenant: (name) =>
      `Pentru a verifica soldul la „${name}”, trimiteți numărul dvs. de telefon — același pe care l-ați dat la punct.`,
    linkInvalid: "Acest link nu mai este valabil",
    notFoundGeneric: (phone) => `Niciun client găsit cu numărul ${phone}`,
    notFoundTenant: (phone, name) => `Niciun client găsit cu numărul ${phone} la „${name}”`,
    yourBalance: "Soldul dvs.",
    balanceWord: "Sold",
    recentOps: "Operațiuni recente",
    openOrders: "Comenzi neutilizate",
    ticketsWord: "bilet(e)",
    typeTopup: "Alimentare",
    typeSpend: "Plată",
    typeRefund: "Rambursare",
    typeAdjustment: "Ajustare",
    ticketOrderPrefix: "Bilete",
    orderExpiringSoon: (n) => `Comanda dvs. nr. ${n} expiră în curând — folosiți biletele la timp.`,
  },
  be: {
    greetingWithName: (n) => `Прывітанне, ${n}!`,
    greetingGeneric: "Прывітанне!",
    shareButton: "📱 Падзяліцца нумарам",
    startHintGeneric: "Каб даведацца баланс, падзяліцеся сваім нумарам тэлефона — тым жа, які вы называлі на пункце пракату.",
    startHintTenant: (name) =>
      `Каб даведацца баланс у «${name}», падзяліцеся сваім нумарам тэлефона — тым жа, які вы называлі на пункце.`,
    linkInvalid: "Спасылка несапраўдная",
    notFoundGeneric: (phone) => `Кліент з нумарам ${phone} не знойдзены ні ў адным пракаце`,
    notFoundTenant: (phone, name) => `Кліент з нумарам ${phone} не знойдзены ў «${name}»`,
    yourBalance: "Ваш баланс",
    balanceWord: "Баланс",
    recentOps: "Апошнія аперацыі",
    openOrders: "Невыкарыстаныя заказы",
    ticketsWord: "білет(аў)",
    typeTopup: "Папаўненне",
    typeSpend: "Спісанне",
    typeRefund: "Вяртанне",
    typeAdjustment: "Налічэнне",
    ticketOrderPrefix: "Білеты",
    orderExpiringSoon: (n) => `Ваш заказ №${n} хутка сканчаецца — паспейце скарыстаць білеты.`,
  },
  pl: {
    greetingWithName: (n) => `Cześć, ${n}!`,
    greetingGeneric: "Witaj!",
    shareButton: "📱 Udostępnij numer telefonu",
    startHintGeneric: "Aby sprawdzić saldo, udostępnij swój numer telefonu — ten sam, który podałeś w punkcie wynajmu.",
    startHintTenant: (name) =>
      `Aby sprawdzić saldo w „${name}”, udostępnij swój numer telefonu — ten sam, który podałeś w punkcie.`,
    linkInvalid: "Ten link jest nieaktualny",
    notFoundGeneric: (phone) => `Nie znaleziono klienta z numerem ${phone}`,
    notFoundTenant: (phone, name) => `Nie znaleziono klienta z numerem ${phone} w „${name}”`,
    yourBalance: "Twoje saldo",
    balanceWord: "Saldo",
    recentOps: "Ostatnie operacje",
    openOrders: "Niewykorzystane zamówienia",
    ticketsWord: "bilet(ów)",
    typeTopup: "Doładowanie",
    typeSpend: "Płatność",
    typeRefund: "Zwrot",
    typeAdjustment: "Korekta",
    ticketOrderPrefix: "Bilety",
    orderExpiringSoon: (n) => `Twoje zamówienie nr ${n} wkrótce wygaśnie — zdąż wykorzystać bilety.`,
  },
  it: {
    greetingWithName: (n) => `Ciao, ${n}!`,
    greetingGeneric: "Ciao!",
    shareButton: "📱 Condividi numero di telefono",
    startHintGeneric: "Per controllare il saldo, condividi il tuo numero di telefono — lo stesso che hai fornito al punto noleggio.",
    startHintTenant: (name) =>
      `Per controllare il saldo presso «${name}», condividi il tuo numero di telefono — lo stesso che hai fornito al punto.`,
    linkInvalid: "Questo link non è più valido",
    notFoundGeneric: (phone) => `Nessun cliente trovato con il numero ${phone}`,
    notFoundTenant: (phone, name) => `Nessun cliente trovato con il numero ${phone} presso «${name}»`,
    yourBalance: "Il tuo saldo",
    balanceWord: "Saldo",
    recentOps: "Operazioni recenti",
    openOrders: "Ordini non utilizzati",
    ticketsWord: "biglietto/i",
    typeTopup: "Ricarica",
    typeSpend: "Pagamento",
    typeRefund: "Rimborso",
    typeAdjustment: "Rettifica",
    ticketOrderPrefix: "Biglietti",
    orderExpiringSoon: (n) => `Il tuo ordine n. ${n} sta per scadere — usa i biglietti in tempo.`,
  },
  uz: {
    greetingWithName: (n) => `Salom, ${n}!`,
    greetingGeneric: "Salom!",
    shareButton: "📱 Telefon raqamini yuborish",
    startHintGeneric: "Balansni bilish uchun telefon raqamingizni yuboring — ijara nuqtasida aytgan raqamingiz bilan.",
    startHintTenant: (name) => `«${name}»dagi balansni bilish uchun telefon raqamingizni yuboring — nuqtada aytgan raqamingiz bilan.`,
    linkInvalid: "Havola endi amal qilmaydi",
    notFoundGeneric: (phone) => `${phone} raqamli mijoz topilmadi`,
    notFoundTenant: (phone, name) => `${phone} raqamli mijoz «${name}»da topilmadi`,
    yourBalance: "Balansingiz",
    balanceWord: "Balans",
    recentOps: "So'nggi operatsiyalar",
    openOrders: "Ishlatilmagan buyurtmalar",
    ticketsWord: "chipta",
    typeTopup: "To'ldirish",
    typeSpend: "To'lov",
    typeRefund: "Qaytarish",
    typeAdjustment: "Tuzatish",
    ticketOrderPrefix: "Chiptalar",
    orderExpiringSoon: (n) => `№${n} buyurtmangiz muddati tugayapti — chiptalardan vaqtida foydalaning.`,
  },
  kk: {
    greetingWithName: (n) => `Сәлем, ${n}!`,
    greetingGeneric: "Сәлем!",
    shareButton: "📱 Телефон нөмірін бөлісу",
    startHintGeneric: "Балансты білу үшін телефон нөміріңізді бөлісіңіз — прокат нүктесінде айтқан нөміріңізбен бірдей.",
    startHintTenant: (name) =>
      `«${name}» балансын білу үшін телефон нөміріңізді бөлісіңіз — нүктеде айтқан нөміріңізбен бірдей.`,
    linkInvalid: "Бұл сілтеме жарамсыз",
    notFoundGeneric: (phone) => `${phone} нөмірлі клиент табылмады`,
    notFoundTenant: (phone, name) => `${phone} нөмірлі клиент «${name}»-де табылмады`,
    yourBalance: "Сіздің балансыңыз",
    balanceWord: "Баланс",
    recentOps: "Соңғы операциялар",
    openOrders: "Пайдаланылмаған тапсырыстар",
    ticketsWord: "билет",
    typeTopup: "Толықтыру",
    typeSpend: "Төлем",
    typeRefund: "Қайтару",
    typeAdjustment: "Түзету",
    ticketOrderPrefix: "Билеттер",
    orderExpiringSoon: (n) => `№${n} тапсырысыңыздың мерзімі жақында аяқталады — билеттерді уақытында пайдаланыңыз.`,
  },
  tg: {
    greetingWithName: (n) => `Салом, ${n}!`,
    greetingGeneric: "Салом!",
    shareButton: "📱 Рақами телефонро мубодила кунед",
    startHintGeneric: "Барои дидани баланс, рақами телефони худро мубодила кунед — ҳамон рақаме, ки дар нуқтаи иҷора гуфта будед.",
    startHintTenant: (name) =>
      `Барои дидани баланс дар «${name}», рақами телефони худро мубодила кунед — ҳамон рақаме, ки дар нуқта гуфта будед.`,
    linkInvalid: "Ин истинод дигар эътибор надорад",
    notFoundGeneric: (phone) => `Мизоҷ бо рақами ${phone} ёфт нашуд`,
    notFoundTenant: (phone, name) => `Мизоҷ бо рақами ${phone} дар «${name}» ёфт нашуд`,
    yourBalance: "Балансатон",
    balanceWord: "Баланс",
    recentOps: "Амалиётҳои охирин",
    openOrders: "Фармоишҳои истифоданашуда",
    ticketsWord: "билет",
    typeTopup: "Пуркунӣ",
    typeSpend: "Пардохт",
    typeRefund: "Баргардонидан",
    typeAdjustment: "Ислоҳ",
    ticketOrderPrefix: "Билетҳо",
    orderExpiringSoon: (n) => `Фармоиши №${n} шумо ба зудӣ анҷом меёбад — билетҳоро сари вақт истифода баред.`,
  },
  ky: {
    greetingWithName: (n) => `Салам, ${n}!`,
    greetingGeneric: "Салам!",
    shareButton: "📱 Телефон номерин бөлүшүү",
    startHintGeneric: "Балансты билүү үчүн телефон номериңизди бөлүшүңүз — прокат пунктунда айткан номериңиз менен бирдей.",
    startHintTenant: (name) =>
      `«${name}» балансын билүү үчүн телефон номериңизди бөлүшүңүз — пунктта айткан номериңиз менен бирдей.`,
    linkInvalid: "Бул шилтеме жараксыз",
    notFoundGeneric: (phone) => `${phone} номериндеги кардар табылган жок`,
    notFoundTenant: (phone, name) => `${phone} номериндеги кардар «${name}»де табылган жок`,
    yourBalance: "Сиздин балансыңыз",
    balanceWord: "Баланс",
    recentOps: "Акыркы операциялар",
    openOrders: "Колдонулбаган буйрутмалар",
    ticketsWord: "билет",
    typeTopup: "Толуктоо",
    typeSpend: "Төлөм",
    typeRefund: "Кайтаруу",
    typeAdjustment: "Түзөтүү",
    ticketOrderPrefix: "Билеттер",
    orderExpiringSoon: (n) => `№${n} буйрутмаңыздын мөөнөтү жакында бүтөт — билеттерди убагында колдонуңуз.`,
  },
  hy: {
    greetingWithName: (n) => `Բարև, ${n}!`,
    greetingGeneric: "Բարև Ձեզ!",
    shareButton: "📱 Կիսվել հեռախոսահամարով",
    startHintGeneric: "Մնացորդը ստուգելու համար կիսվեք ձեր հեռախոսահամարով՝ նույնը, որ նշել եք վարձակալման կետում։",
    startHintTenant: (name) =>
      `«${name}»-ում մնացորդը ստուգելու համար կիսվեք ձեր հեռախոսահամարով՝ նույնը, որ նշել եք կետում։`,
    linkInvalid: "Այս հղումն այլևս վավեր չէ",
    notFoundGeneric: (phone) => `${phone} համարով հաճախորդ չի գտնվել`,
    notFoundTenant: (phone, name) => `${phone} համարով հաճախորդ չի գտնվել «${name}»-ում`,
    yourBalance: "Ձեր մնացորդը",
    balanceWord: "Մնացորդ",
    recentOps: "Վերջին գործառնությունները",
    openOrders: "Չօգտագործված պատվերներ",
    ticketsWord: "տոմս",
    typeTopup: "Համալրում",
    typeSpend: "Վճարում",
    typeRefund: "Վերադարձ",
    typeAdjustment: "Ճշգրտում",
    ticketOrderPrefix: "Տոմսեր",
    orderExpiringSoon: (n) => `Ձեր №${n} պատվերը շուտով կլրանա՝ հասցրեք օգտագործել տոմսերը։`,
  },
  az: {
    greetingWithName: (n) => `Salam, ${n}!`,
    greetingGeneric: "Salam!",
    shareButton: "📱 Telefon nömrəsini paylaş",
    startHintGeneric: "Balansı yoxlamaq üçün telefon nömrənizi paylaşın — icarə nöqtəsində dediyiniz eyni nömrə.",
    startHintTenant: (name) => `«${name}»-də balansı yoxlamaq üçün telefon nömrənizi paylaşın — nöqtədə dediyiniz eyni nömrə.`,
    linkInvalid: "Bu link artıq etibarlı deyil",
    notFoundGeneric: (phone) => `${phone} nömrəli müştəri tapılmadı`,
    notFoundTenant: (phone, name) => `${phone} nömrəli müştəri «${name}»-də tapılmadı`,
    yourBalance: "Balansınız",
    balanceWord: "Balans",
    recentOps: "Son əməliyyatlar",
    openOrders: "İstifadə olunmamış sifarişlər",
    ticketsWord: "bilet",
    typeTopup: "Artırma",
    typeSpend: "Ödəniş",
    typeRefund: "Geri qaytarma",
    typeAdjustment: "Düzəliş",
    ticketOrderPrefix: "Biletlər",
    orderExpiringSoon: (n) => `№${n} sifarişinizin müddəti tezliklə bitir — biletlərdən vaxtında istifadə edin.`,
  },
  ka: {
    greetingWithName: (n) => `გამარჯობა, ${n}!`,
    greetingGeneric: "გამარჯობა!",
    shareButton: "📱 ტელეფონის ნომრის გაზიარება",
    startHintGeneric: "ბალანსის საჩვენებლად გააზიარეთ თქვენი ტელეფონის ნომერი — იგივე, რომელიც დაასახელეთ გაქირავების პუნქტში.",
    startHintTenant: (name) =>
      `«${name}»-ში ბალანსის საჩვენებლად გააზიარეთ თქვენი ტელეფონის ნომერი — იგივე, რომელიც დაასახელეთ პუნქტში.`,
    linkInvalid: "ეს ბმული აღარ არის აქტიური",
    notFoundGeneric: (phone) => `${phone} ნომრით კლიენტი ვერ მოიძებნა`,
    notFoundTenant: (phone, name) => `${phone} ნომრით კლიენტი «${name}»-ში ვერ მოიძებნა`,
    yourBalance: "თქვენი ბალანსი",
    balanceWord: "ბალანსი",
    recentOps: "ბოლო ოპერაციები",
    openOrders: "გამოუყენებელი შეკვეთები",
    ticketsWord: "ბილეთი",
    typeTopup: "შევსება",
    typeSpend: "გადახდა",
    typeRefund: "დაბრუნება",
    typeAdjustment: "კორექტირება",
    ticketOrderPrefix: "ბილეთები",
    orderExpiringSoon: (n) => `თქვენი შეკვეთა №${n} მალე ამოიწურება — მოასწარით ბილეთების გამოყენება.`,
  },
  tr: {
    greetingWithName: (n) => `Merhaba, ${n}!`,
    greetingGeneric: "Merhaba!",
    shareButton: "📱 Telefon numarasını paylaş",
    startHintGeneric: "Bakiyenizi kontrol etmek için telefon numaranızı paylaşın — kiralama noktasında verdiğiniz numarayla aynı.",
    startHintTenant: (name) =>
      `«${name}»'da bakiyenizi kontrol etmek için telefon numaranızı paylaşın — noktada verdiğiniz numarayla aynı.`,
    linkInvalid: "Bu bağlantı artık geçerli değil",
    notFoundGeneric: (phone) => `${phone} numaralı müşteri bulunamadı`,
    notFoundTenant: (phone, name) => `${phone} numaralı müşteri «${name}»'da bulunamadı`,
    yourBalance: "Bakiyeniz",
    balanceWord: "Bakiye",
    recentOps: "Son işlemler",
    openOrders: "Kullanılmamış siparişler",
    ticketsWord: "bilet",
    typeTopup: "Yükleme",
    typeSpend: "Ödeme",
    typeRefund: "İade",
    typeAdjustment: "Düzeltme",
    ticketOrderPrefix: "Biletler",
    orderExpiringSoon: (n) => `№${n} siparişinizin süresi yakında doluyor — biletlerinizi zamanında kullanın.`,
  },
};
