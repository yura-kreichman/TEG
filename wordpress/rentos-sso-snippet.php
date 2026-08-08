/**
 * RentOS: единый вход и роль клиента.
 *
 * Источник входа — приложение my.rentos365.app. Этот сайт никого не
 * аутентифицирует сам: он отправляет человека в приложение и принимает оттуда
 * одноразовый код, который обменивает на подтверждённые данные владельца.
 * Пароли между системами не передаются никогда.
 *
 * Зачем так, а не наоборот: в приложении живут тенанты, владельцы, сотрудники
 * с PIN-ами и лимиты пакета. Сделать WordPress хозяином этих аккаунтов значило
 * бы защитить кассы всех тенантов плагином на маркетинговом сайте.
 */

if (!defined('RENTOS_APP_URL')) {
    define('RENTOS_APP_URL', 'https://my.rentos365.app');
}

/**
 * Секрет в сниппете НЕ ХРАНИТСЯ — он живёт в wp-config.php как константа
 * RENTOS_SSO_SECRET (то же значение, что в SSO_SHARED_SECRET у приложения).
 *
 * Причина не теоретическая. 8 августа хранилище сниппета осталось без
 * открывающего тега PHP, код начал печататься как текст, и секрет оказался в
 * публичном HTML экрана входа. Секрет тогда сменили. В wp-config.php такого
 * произойти не может: его содержимое не выводится ни при какой поломке
 * сниппета.
 *
 * И да: в комментариях этого файла нельзя писать открывающий и закрывающий теги
 * PHP буквально — они переключают режим парсера даже внутри комментария.
 *
 * Константы нет — единый вход просто не работает, и это правильно: молча
 * ходить с пустым секретом хуже, чем не ходить вовсе.
 */
function rentos_sso_secret()
{
    return defined('RENTOS_SSO_SECRET') ? (string) RENTOS_SSO_SECRET : '';
}

const RENTOS_CLIENT_ROLE = 'rentos_client';
const RENTOS_STATE_COOKIE = 'rentos_sso_state';
const RENTOS_TARGET_COOKIE = 'rentos_sso_to';

/* --------------------------------------------------------------- строки */

/**
 * Свои строки на пяти языках сайта (TranslatePress: ru, en, uk, it, ro).
 *
 * Почему прямо здесь, а не только через TranslatePress: TP переводит уже
 * отрендеренный HTML, и до того, как кто-то откроет его редактор и внесёт
 * перевод, кнопка на английской версии сайта была бы по-русски. С этой таблицей
 * она сразу правильная, а TP при желании всё равно может её переопределить —
 * он работает поверх вывода.
 *
 * Ключ языка берём из get_locale(): TranslatePress подменяет локаль запроса,
 * поэтому на /en/ здесь окажется en_US.
 */
function rentos_t($key)
{
    static $strings = [
        'login_button' => [
            'ru_RU' => 'Войти через RentOS',
            'en_US' => 'Sign in with RentOS',
            'uk'    => 'Увійти через RentOS',
            'it_IT' => 'Accedi con RentOS',
            'ro_RO' => 'Conectare cu RentOS',
        ],
        'err_expired' => [
            'ru_RU' => 'Ссылка входа устарела. Попробуйте ещё раз.',
            'en_US' => 'The sign-in link has expired. Please try again.',
            'uk'    => 'Посилання для входу застаріло. Спробуйте ще раз.',
            'it_IT' => 'Il link di accesso è scaduto. Riprova.',
            'ro_RO' => 'Linkul de conectare a expirat. Încercați din nou.',
        ],
        'err_unreachable' => [
            'ru_RU' => 'Не удалось связаться с RentOS. Попробуйте позже.',
            'en_US' => 'Could not reach RentOS. Please try later.',
            'uk'    => 'Не вдалося зв’язатися з RentOS. Спробуйте пізніше.',
            'it_IT' => 'Impossibile contattare RentOS. Riprova più tardi.',
            'ro_RO' => 'Nu s-a putut contacta RentOS. Încercați mai târziu.',
        ],
        'err_rejected' => [
            'ru_RU' => 'Вход не подтверждён. Попробуйте ещё раз.',
            'en_US' => 'Sign-in was not confirmed. Please try again.',
            'uk'    => 'Вхід не підтверджено. Спробуйте ще раз.',
            'it_IT' => 'Accesso non confermato. Riprova.',
            'ro_RO' => 'Conectarea nu a fost confirmată. Încercați din nou.',
        ],
        'err_generic' => [
            'ru_RU' => 'Не удалось войти. Попробуйте ещё раз.',
            'en_US' => 'Sign-in failed. Please try again.',
            'uk'    => 'Не вдалося увійти. Спробуйте ще раз.',
            'it_IT' => 'Accesso non riuscito. Riprova.',
            'ro_RO' => 'Conectarea a eșuat. Încercați din nou.',
        ],
        'back_home' => [
            'ru_RU' => 'На главную',
            'en_US' => 'Back to home',
            'uk'    => 'На головну',
            'it_IT' => 'Torna alla home',
            'ro_RO' => 'Înapoi la pagina principală',
        ],
        // Строка над кнопкой в портале поддержки. Раньше лежала прямо в
        // настройках Fluent Support (login_message) — то есть одним русским
        // текстом на все языки: TranslatePress её не подхватывал, и на /en/
        // человек читал русское предложение.
        'sign_in_hint_support' => [
            'ru_RU' => 'Войдите через RentOS, чтобы открыть портал поддержки',
            'en_US' => 'Sign in with RentOS to open the support portal',
            'uk'    => 'Увійдіть через RentOS, щоб відкрити портал підтримки',
            'it_IT' => 'Accedi con RentOS per aprire il portale di assistenza',
            'ro_RO' => 'Conectați-vă cu RentOS pentru a deschide portalul de asistență',
        ],
        'sign_in_hint' => [
            'ru_RU' => 'Подписка, платежи и поддержка — в вашем аккаунте RentOS',
            'en_US' => 'Your subscription, payments and support live in your RentOS account',
            'uk'    => 'Підписка, платежі та підтримка — у вашому акаунті RentOS',
            'it_IT' => 'Abbonamento, pagamenti e assistenza si trovano nel tuo account RentOS',
            'ro_RO' => 'Abonamentul, plățile și asistența se află în contul tău RentOS',
        ],
        'go_to_account' => [
            'ru_RU' => 'Перейти в Аккаунт',
            'en_US' => 'Go to my account',
            'uk'    => 'Перейти в Акаунт',
            'it_IT' => 'Vai al mio account',
            'ro_RO' => 'Mergi la contul meu',
        ],
        'sign_in_title' => [
            'ru_RU' => 'Вход через RentOS',
            'en_US' => 'Sign in with RentOS',
            'uk'    => 'Вхід через RentOS',
            'it_IT' => 'Accesso con RentOS',
            'ro_RO' => 'Conectare cu RentOS',
        ],
    ];

    $locale = get_locale();
    $row = $strings[$key] ?? [];
    if (isset($row[$locale])) {
        return $row[$locale];
    }
    // Язык без страны (uk) и наоборот — сверяем по первым двум буквам, чтобы
    // ru_UA или en_GB не проваливались в русский по умолчанию.
    $short = substr((string) $locale, 0, 2);
    foreach ($row as $code => $text) {
        if (substr($code, 0, 2) === $short) {
            return $text;
        }
    }
    return $row['ru_RU'] ?? '';
}

/* ------------------------------------------------------------------ роль */

/**
 * Отдельная роль для клиентов вместо «Подписчика» (решение владельца
 * 2026-08-08): по роли сразу видно, кто это, и права клиента можно менять не
 * задевая остальных подписчиков сайта.
 *
 * Возможность только одна — read. Клиентский портал FluentCart и портал
 * Fluent Support не проверяют ни роль, ни capability: им достаточно, что
 * человек вошёл (см. CustomerPortalHandler::hasCustomerPortalAccess).
 */
add_action('init', function () {
    if (!get_role(RENTOS_CLIENT_ROLE)) {
        add_role(RENTOS_CLIENT_ROLE, 'Клиент RentOS', ['read' => true]);
    }
});

/**
 * Покупка подписки создаёт WP-пользователя сама (FluentCart,
 * user_account_creation_mode = only_subscription), но с ролью по умолчанию,
 * то есть «Подписчик». Переставляем на нашу.
 *
 * Администратора и агентов поддержки не понижаем: если владелец сайта купит
 * свой же пакет для проверки, он не должен потерять доступ к админке.
 */
add_action('fluent_cart/user/after_register', function ($userId) {
    rentos_mark_as_client($userId);
}, 20);

function rentos_mark_as_client($userId)
{
    $user = get_user_by('ID', $userId);
    if (!$user) {
        return;
    }
    $keepRoles = ['administrator', 'editor', 'author', 'fs_agent', 'fs_support_agent'];
    if (array_intersect((array) $user->roles, $keepRoles)) {
        return;
    }
    $user->set_role(RENTOS_CLIENT_ROLE);
}

/**
 * Клиенту в wp-admin делать нечего: его места — портал заказов и портал
 * поддержки. Админ-бар для этой роли скрывает сам FluentAuth
 * (disable_bar_roles), здесь закрываем саму админку.
 *
 * admin-ajax.php не трогаем: через него работают формы на публичных
 * страницах, включая портал поддержки.
 */
add_action('admin_init', function () {
    if (wp_doing_ajax() || !is_user_logged_in()) {
        return;
    }
    $user = wp_get_current_user();
    if (in_array(RENTOS_CLIENT_ROLE, (array) $user->roles, true) && !current_user_can('manage_options')) {
        wp_safe_redirect(rentos_after_login_url());
        exit;
    }
});

/* ---------------------------------------------------------------- кнопка */

/**
 * Логотип RentOS инлайном, а не картинкой по ссылке: кнопка должна
 * отрисоваться даже если приложение недоступно, и не тянуть внешний запрос на
 * страницу входа. Идентификаторы градиентов с префиксом — на странице может
 * быть другой SVG со своими id0/id1.
 */
function rentos_logo_svg($size = 20)
{
    return '<svg width="' . (int) $size . '" height="' . (int) $size . '" viewBox="0 0 470.15 432.07" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="flex:0 0 auto">'
        . '<defs>'
        . '<linearGradient id="rentosGradA" gradientUnits="userSpaceOnUse" x1="186.47" y1="280.15" x2="418.89" y2="48.56">'
        . '<stop offset="0" stop-color="#16B5F7"/><stop offset="0.568627" stop-color="#0B85E2"/><stop offset="1" stop-color="#0055CC"/>'
        . '</linearGradient>'
        . '<linearGradient id="rentosGradB" gradientUnits="userSpaceOnUse" x1="153.99" y1="155.79" x2="316.16" y2="441.32">'
        . '<stop offset="0" stop-color="#0055CC"/><stop offset="0.65098" stop-color="#7F2BE5"/><stop offset="1" stop-color="#FF00FF"/>'
        . '</linearGradient>'
        . '</defs>'
        . '<path fill="url(#rentosGradB)" d="M3.4 195.04l128.2 223.38c3.32,5.43 9.66,13.02 16.95,13.43l302.6 0.22c15.24,-1.45 22.41,-13.12 17.46,-26.94l-136.59 -239.75 -132.49 165.5 1.18 -101.26 -59.39 -62.39 -126.35 -2.17c-9.61,2.08 -20.67,13.88 -11.56,30z"/>'
        . '<path fill="url(#rentosGradA)" d="M139.21 0l158.08 3.11c264.21,27.16 178.93,332.72 15.47,325.3l-108.1 0.3 127.36 -163.33 -193.1 1.8 0.29 -167.18z"/>'
        . '</svg>';
}

/** Адрес запуска входа. $to — куда вернуть человека после. */
function rentos_sso_start_url($to = '')
{
    $args = ['rentos_sso' => 'start'];
    if ($to) {
        $args['to'] = $to;
    }

    return add_query_arg($args, home_url('/'));
}

function rentos_login_button_html()
{
    // Куда человек шёл до того, как его попросили войти. Обычно приходит
    // параметром redirect_to — тем же, каким его передаёт WordPress. Если
    // параметра нет, возвращаем туда, где кнопку нажали: у подпутей вида
    // /account/subscriptions страница та же, а вернуть надо именно на подпуть, и
    // со страницы поддержки — на неё же.
    //
    // Исключение — wp-login.php: возвращать человека на служебный экран
    // WordPress незачем, ему место в кабинете.
    $to = isset($_GET['redirect_to']) ? wp_unslash($_GET['redirect_to']) : '';
    $isWpLogin = isset($GLOBALS['pagenow']) && $GLOBALS['pagenow'] === 'wp-login.php';
    if (!$to && !is_admin() && !$isWpLogin) {
        $to = rentos_current_url();
    }

    // Уже вошёл — кнопка входа бессмысленна, но и пустое место вместо неё
    // оставлять нельзя: экран входа выглядел бы сломанным. Ведём туда, куда
    // человек шёл, иначе в кабинет заказов.
    if (is_user_logged_in()) {
        $target = $to ? wp_validate_redirect($to, '') : '';

        return rentos_button_markup($target ?: rentos_after_login_url(), rentos_t('go_to_account'));
    }

    return rentos_button_markup(rentos_sso_start_url($to), rentos_t('login_button'));
}

/** Стили внутри разметки, а не в теме: кнопка живёт и на wp-login.php. */
function rentos_button_markup($url, $label)
{
    return '<div class="rentos-sso-wrap" style="margin:16px 0 8px">'
        . '<a class="rentos-sso-btn" href="' . esc_url($url) . '" '
        . 'style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;'
        . 'padding:11px 16px;border:1px solid #d5d8dd;border-radius:10px;background:#fff;color:#19283a;'
        . 'font-weight:600;font-size:14px;line-height:1.2;text-decoration:none">'
        . rentos_logo_svg(20)
        . '<span>' . esc_html($label) . '</span>'
        . '</a></div>';
}

// Те же точки, куда FluentAuth вставляет свои социальные кнопки: классический
// экран wp-login.php, собственная форма FluentAuth и форма Fluent Support.
add_action('login_form', function () {
    echo rentos_login_button_html();
});
add_action('register_form', function () {
    echo rentos_login_button_html();
});
add_filter('login_form_bottom', function ($html) {
    return $html . rentos_login_button_html();
});
add_filter('fluent_support/before_registration_form_close', function ($html) {
    return $html . rentos_login_button_html();
});
/**
 * Для произвольного места на странице и для сообщения входа Fluent Support.
 *
 * hint="yes" добавляет строку-пояснение сверху. Она нужна в портале поддержки, а
 * на wp-login.php лишняя — поэтому атрибут, а не всегда.
 */
add_shortcode('rentos_login_button', function ($atts) {
    $atts = shortcode_atts(['hint' => 'no'], $atts, 'rentos_login_button');

    $hint = '';
    if ($atts['hint'] === 'yes' && !is_user_logged_in()) {
        $hint = '<p style="margin:0 0 12px">' . esc_html(rentos_t('sign_in_hint_support')) . '</p>';
    }

    return $hint . rentos_login_button_html();
});

/*
 * Полей логина и пароля на wp-login.php мы НЕ прячем (решение владельца
 * 2026-08-08). Пробовали — и отказались от самой затеи: клиент вообще не должен
 * видеть служебный адрес WordPress, у него своя страница входа на домене сайта.
 * Тогда прятать что-то на wp-login.php незачем: он остаётся дверью
 * администратора, какой и был.
 */

/* ------------------------------------------------------- мелочи портала */

/**
 * У пункта «Поддержка» в портале заказов не было иконки — на её месте пустое
 * место. Свой раздел в портале FluentCart регистрирует сам Fluent Support
 * (FluentCart::renderCustomerPortalInFluentCartDashboard) и icon_svg не
 * передаёт. Дорисовываем фильтром, плагин не правим.
 *
 * Иконка — один path с fill="currentColor" и без прочих атрибутов: вывод
 * проходит через wp_kses со списком, где разрешены только svg, path и g
 * (fct_allowed_svg_tags), остальное вырезается молча. Та же гарнитура, что у
 * соседних пунктов, — Remix Icon, customer-service-2-line.
 *
 * Рисунок пересчитан из сетки 24 в сетку 20 намеренно. wp_kses приводит имена
 * атрибутов к нижнему регистру, а в списке разрешённых стоит viewBox — и
 * атрибут вылетает. Без него система координат равна width/height, поэтому
 * рисунок из 24 единиц был бы обрезан. Соседние иконки плагина живут в 20
 * единицах и того же не замечают.
 */
add_filter('fluent_cart/global_customer_menu_items', function ($items) {
    if (!isset($items['fluent-support']) || !empty($items['fluent-support']['icon_svg'])) {
        return $items;
    }

    $items['fluent-support']['icon_svg'] = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">'
        . '<path d="M16.6151 6.6667H17.5C18.4205 6.6667 19.1667 7.4129 19.1667 8.3333V11.6667C19.1667 12.5872 18.4205 13.3333 17.5 13.3333H16.6151C16.205 16.6219 13.3997 19.1667 10 19.1667V17.5C12.7614 17.5 15 15.2614 15 12.5V7.5C15 4.7386 12.7614 2.5 10 2.5C7.2386 2.5 5 4.7386 5 7.5V13.3333H2.5C1.5795 13.3333 0.8333 12.5872 0.8333 11.6667V8.3333C0.8333 7.4129 1.5795 6.6667 2.5 6.6667H3.3849C3.795 3.3781 6.6003 0.8333 10 0.8333C13.3997 0.8333 16.205 3.3781 16.6151 6.6667ZM2.5 8.3333V11.6667H3.3333V8.3333H2.5ZM16.6667 8.3333V11.6667H17.5V8.3333H16.6667ZM6.4662 13.1541L7.3497 11.7406C8.118 12.2218 9.0265 12.5 10 12.5C10.9735 12.5 11.882 12.2218 12.6503 11.7406L13.5338 13.1541C12.5093 13.7958 11.298 14.1667 10 14.1667C8.702 14.1667 7.4907 13.7958 6.4662 13.1541Z"/>'
        . '</svg>';

    return $items;
}, 20);

/* --------------------------------- «Аккаунт» — единственный экран входа */

/*
 * Отдельной страницы «Вход» больше нет (решение владельца 2026-08-08). Она была
 * технической прокладкой: ни один пункт меню на неё не ссылался, а держала она
 * одну кнопку. Вход и у FluentCart, и у Fluent Support теперь идёт через
 * страницу «Аккаунт» — ту же, куда человек и шёл.
 */

/** Адрес экрана входа = сама страница аккаунта. */
function rentos_login_screen_url($redirectTo = '')
{
    $portalId = rentos_portal_page_id();
    if (!$portalId) {
        // Страницы аккаунта нет — не подменяем ничего, пусть работает штатный вход.
        return $redirectTo ? wp_login_url($redirectTo) : wp_login_url();
    }

    $url = get_permalink($portalId);

    return $redirectTo ? add_query_arg('redirect_to', $redirectTo, $url) : $url;
}

/**
 * Текущий адрес целиком.
 *
 * Основание берём из option 'home', а НЕ из home_url(): TranslatePress
 * подставляет в home_url() языковой префикс текущего запроса, а он уже есть в
 * REQUEST_URI — на английской версии получалось /en/en/account/, и после входа
 * человек попадал в никуда. Опция хранит адрес без префикса.
 */
function rentos_current_url()
{
    $root = untrailingslashit((string) get_option('home'));
    $uri = isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '/';

    return $root . $uri;
}

/** Сейчас показывается страница аккаунта (включая её подпути вида /account/profile)? */
function rentos_is_account_screen()
{
    $portalId = rentos_portal_page_id();

    return $portalId && get_queried_object_id() === $portalId;
}

/**
 * Публичные ссылки «войти» ведут на «Аккаунт», а не на wp-login.php.
 *
 * Разделение по контексту, а не по роли: на сайте «войти» значит «войти
 * клиентом», в админке — «войти в WordPress». Поэтому wp-admin, сам wp-login.php,
 * AJAX и REST не трогаем: иначе истёкшая сессия администратора уводила бы его на
 * страницу, где нет ни поля пароля, ни смысла.
 *
 * На самой странице аккаунта «войти» означает уже не «иди туда», а «начинай
 * вход»: ссылка на себя же была бы тупиком. Так подстрахован и случай, если
 * подмена экрана ниже однажды перестанет срабатывать.
 */
add_filter('login_url', function ($url, $redirect = '') {
    if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
        return $url;
    }
    if (isset($GLOBALS['pagenow']) && $GLOBALS['pagenow'] === 'wp-login.php') {
        return $url;
    }
    if (!rentos_portal_page_id()) {
        return $url;
    }
    if (rentos_is_account_screen()) {
        return rentos_sso_start_url($redirect ?: rentos_current_url());
    }

    return rentos_login_screen_url($redirect);
}, 10, 2);

/**
 * Гостю на странице аккаунта показываем свою кнопку вместо экрана входа
 * FluentCart. Заменяем вывод блока целиком, а не правим его разметку: разметка
 * чужая и меняется с версиями, а имя блока — публичный контракт.
 *
 * Проверять роль не нужно: сюда попадают только гости, а вошедший видит портал
 * плагина как есть.
 */
add_filter('render_block', function ($html, $block) {
    if (($block['blockName'] ?? '') !== 'fluent-cart/customer-profile') {
        return $html;
    }
    if (is_user_logged_in()) {
        return $html;
    }

    return '<div class="rentos-login-screen" style="max-width:420px;margin:48px auto;text-align:center">'
        . '<h2 style="margin:0 0 8px">' . esc_html(rentos_t('sign_in_title')) . '</h2>'
        . '<p style="margin:0 0 20px;color:#5b6472">' . esc_html(rentos_t('sign_in_hint')) . '</p>'
        . rentos_login_button_html()
        . '</div>';
}, 10, 2);

/*
 * Страницу поддержки гостя НЕ уводим никуда — и это осознанно.
 *
 * Сначала я поставил здесь редирект на «Аккаунт» и этим сломал живое: страница
 * «Техническая поддержка» — публичная, на ней заголовок и список того, что даёт
 * аккаунт, а гостя из футера уносило на экран входа, не дав ничего прочитать.
 *
 * Читать её незачем мешать: вход и оттуда идёт через тот же единый механизм.
 * Портал Fluent Support при ticket_link_portal = fluent_cart живёт внутри
 * кабинета заказов, поэтому гостю шорткод отдаёт нашу кнопку (login_message в
 * global_business_settings), а вернёт она его туда же, на страницу поддержки.
 */

/* ------------------------------------------------------------ сам вход */

function rentos_callback_url()
{
    return add_query_arg('rentos_sso', 'callback', home_url('/'));
}

/** Портал заказов FluentCart — по настройке плагина, не по угаданному слагу. */
function rentos_portal_page_id()
{
    $settings = get_option('fluent_cart_store_settings');
    if (!is_array($settings) || empty($settings['customer_profile_page_id'])) {
        return 0;
    }
    $pageId = (int) $settings['customer_profile_page_id'];

    return ($pageId && get_post_status($pageId) === 'publish') ? $pageId : 0;
}

/**
 * Куда отправлять после входа: туда, откуда человека попросили войти, иначе —
 * в портал заказов.
 *
 * Цель мы храним в куке, а не тащим через приложение: адрес возврата
 * (redirect_uri) приложение сверяет со своим белым списком и возвращает нам
 * обратно для проверки, так что он должен оставаться неизменным.
 */
function rentos_after_login_url()
{
    $to = isset($_COOKIE[RENTOS_TARGET_COOKIE]) ? wp_unslash($_COOKIE[RENTOS_TARGET_COOKIE]) : '';
    // wp_validate_redirect отсеивает чужие хосты — «//чужой.сайт» браузер
    // понимает как адрес, а не как путь.
    $to = $to ? wp_validate_redirect($to, '') : '';
    if ($to) {
        return $to;
    }

    $portalId = rentos_portal_page_id();

    return $portalId ? get_permalink($portalId) : home_url('/');
}

/** Запомнить или сбросить цель возврата. */
function rentos_set_target_cookie($to)
{
    setcookie(RENTOS_TARGET_COOKIE, $to, [
        'expires'  => $to ? time() + 600 : time() - 3600,
        'path'     => '/',
        'secure'   => is_ssl(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    if (!$to) {
        unset($_COOKIE[RENTOS_TARGET_COOKIE]);
    } else {
        $_COOKIE[RENTOS_TARGET_COOKIE] = $to;
    }
}

add_action('template_redirect', function () {
    $action = isset($_GET['rentos_sso']) ? sanitize_text_field(wp_unslash($_GET['rentos_sso'])) : '';
    if (!$action) {
        return;
    }

    if ($action === 'start') {
        rentos_sso_start();
        return;
    }
    if ($action === 'callback') {
        rentos_sso_callback();
    }
});

function rentos_sso_start()
{
    $to = isset($_GET['to']) ? wp_unslash($_GET['to']) : '';
    rentos_set_target_cookie($to ? wp_validate_redirect($to, '') : '');

    if (is_user_logged_in()) {
        wp_safe_redirect(rentos_after_login_url());
        exit;
    }

    // state — наш собственный нонс: приложение возвращает его как есть, и по
    // нему мы убеждаемся, что пришедший ответ отвечает на НАШ запрос, а не
    // подсунут со стороны.
    $state = wp_generate_password(32, false, false);
    setcookie(RENTOS_STATE_COOKIE, $state, [
        'expires'  => time() + 600,
        'path'     => '/',
        'secure'   => is_ssl(),
        'httponly' => true,
        'samesite' => 'Lax', // Lax, не Strict: возврат идёт переходом с другого домена
    ]);

    $url = add_query_arg([
        'redirect_uri' => rawurlencode(rentos_callback_url()),
        'state'        => $state,
    ], RENTOS_APP_URL . '/api/sso/authorize');

    // wp_redirect, а не wp_safe_redirect: адрес внешний и намеренно.
    wp_redirect($url);
    exit;
}

function rentos_sso_callback()
{
    $code = isset($_GET['code']) ? sanitize_text_field(wp_unslash($_GET['code'])) : '';
    $state = isset($_GET['state']) ? sanitize_text_field(wp_unslash($_GET['state'])) : '';
    $expected = isset($_COOKIE[RENTOS_STATE_COOKIE]) ? sanitize_text_field(wp_unslash($_COOKIE[RENTOS_STATE_COOKIE])) : '';

    // Куку гасим сразу и при любом исходе: одна попытка на один запуск.
    setcookie(RENTOS_STATE_COOKIE, '', ['expires' => time() - 3600, 'path' => '/']);

    if (!$code || !$state || !$expected || !hash_equals($expected, $state)) {
        rentos_sso_fail(rentos_t('err_expired'));
    }

    $response = wp_remote_post(RENTOS_APP_URL . '/api/sso/exchange', [
        'timeout' => 15,
        'headers' => [
            'Content-Type'          => 'application/json',
            'x-rentos-sso-secret'   => rentos_sso_secret(),
        ],
        'body'    => wp_json_encode(['code' => $code]),
    ]);

    if (is_wp_error($response)) {
        rentos_sso_fail(rentos_t('err_unreachable'));
    }
    if (wp_remote_retrieve_response_code($response) !== 200) {
        rentos_sso_fail(rentos_t('err_rejected'));
    }

    $data = json_decode(wp_remote_retrieve_body($response), true);
    $email = is_array($data) && !empty($data['email']) ? sanitize_email($data['email']) : '';
    if (!$email || !is_email($email)) {
        rentos_sso_fail(rentos_t('err_generic'));
    }

    // Код выдавался под конкретный адрес возврата — сверяем со своим, чтобы
    // код, полученный для другой страницы, нельзя было предъявить здесь.
    if (empty($data['redirectUri']) || $data['redirectUri'] !== rentos_callback_url()) {
        rentos_sso_fail(rentos_t('err_generic'));
    }

    $user = rentos_find_or_create_user($email, $data);
    if (is_wp_error($user)) {
        rentos_sso_fail(rentos_t('err_generic'));
    }

    wp_set_current_user($user->ID);
    wp_set_auth_cookie($user->ID, true, is_ssl());
    do_action('wp_login', $user->user_login, $user);

    // Адрес считаем до сброса куки — она и есть источник цели.
    $target = rentos_after_login_url();
    rentos_set_target_cookie('');

    wp_safe_redirect($target);
    exit;
}

/**
 * Ищем сначала по идентификатору покупателя FluentCart, потом по email.
 * Порядок важен: email в WordPress можно завести любой, и связывать по нему в
 * первую очередь означало бы, что чужая регистрация с вашим адресом получает
 * вашего покупателя. Идентификатор покупателя приходит от приложения, которое
 * получило его от самого FluentCart.
 */
function rentos_find_or_create_user($email, $data)
{
    $customerId = !empty($data['fluentcartCustomerId']) ? (string) $data['fluentcartCustomerId'] : '';
    if ($customerId) {
        global $wpdb;
        $userId = $wpdb->get_var(
            $wpdb->prepare("SELECT user_id FROM {$wpdb->prefix}fct_customers WHERE id = %s AND user_id > 0", $customerId)
        );
        if ($userId) {
            $found = get_user_by('ID', (int) $userId);
            if ($found) {
                return $found;
            }
        }
    }

    $found = get_user_by('email', $email);
    if ($found) {
        return $found;
    }

    $login = rentos_unique_login($email);
    $userId = wp_insert_user([
        'user_login'    => $login,
        'user_email'    => $email,
        // Пароль случайный и никому не сообщается: вход только через RentOS.
        'user_pass'     => wp_generate_password(40, true, true),
        'display_name'  => !empty($data['tenantName']) ? sanitize_text_field($data['tenantName']) : $login,
        'role'          => RENTOS_CLIENT_ROLE,
    ]);
    if (is_wp_error($userId)) {
        return $userId;
    }
    return get_user_by('ID', $userId);
}

function rentos_unique_login($email)
{
    $base = sanitize_user(current(explode('@', $email)), true);
    if (!$base) {
        $base = 'rentos';
    }
    $login = $base;
    $i = 2;
    while (username_exists($login)) {
        $login = $base . $i;
        $i++;
    }
    return $login;
}

function rentos_sso_fail($message)
{
    wp_die(
        esc_html($message) . '<p><a href="' . esc_url(home_url('/')) . '">' . esc_html(rentos_t('back_home')) . '</a></p>',
        rentos_t('sign_in_title'),
        ['response' => 400, 'back_link' => false]
    );
}
