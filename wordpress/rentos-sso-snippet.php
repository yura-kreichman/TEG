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

function rentos_login_button_html()
{
    if (is_user_logged_in()) {
        return '';
    }
    $url = add_query_arg('rentos_sso', 'start', home_url('/'));

    return '<div class="rentos-sso-wrap" style="margin:16px 0 8px">'
        . '<a class="rentos-sso-btn" href="' . esc_url($url) . '" '
        . 'style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;'
        . 'padding:11px 16px;border:1px solid #d5d8dd;border-radius:10px;background:#fff;color:#19283a;'
        . 'font-weight:600;font-size:14px;line-height:1.2;text-decoration:none">'
        . rentos_logo_svg(20)
        . '<span>' . esc_html(rentos_t('login_button')) . '</span>'
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
// Для произвольного места на странице Elementor.
add_shortcode('rentos_login_button', function () {
    return rentos_login_button_html();
});

/*
 * Полей логина и пароля на wp-login.php мы НЕ прячем (решение владельца
 * 2026-08-08). Пробовали — и отказались от самой затеи: клиент вообще не должен
 * видеть служебный адрес WordPress, у него своя страница входа на домене сайта.
 * Тогда прятать что-то на wp-login.php незачем: он остаётся дверью
 * администратора, какой и был.
 */

/* ------------------------------------------------------------ сам вход */

function rentos_callback_url()
{
    return add_query_arg('rentos_sso', 'callback', home_url('/'));
}

/** Куда отправлять клиента после входа — портал заказов FluentCart. */
function rentos_after_login_url()
{
    if (function_exists('home_url')) {
        $pageId = 0;
        $settings = get_option('fluent_cart_store_settings');
        if (is_array($settings) && !empty($settings['customer_profile_page_id'])) {
            $pageId = (int) $settings['customer_profile_page_id'];
        }
        if ($pageId && get_post_status($pageId) === 'publish') {
            return get_permalink($pageId);
        }
    }
    return home_url('/');
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

    wp_safe_redirect(rentos_after_login_url());
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
