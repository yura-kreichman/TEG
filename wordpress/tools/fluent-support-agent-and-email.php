<?php
/**
 * 1. Профиль агента поддержки: имя, должность, фото, рабочая почта.
 * 2. Замена личного адреса владельца на корпоративный по сайту (решение владельца 2026-08-22).
 *
 * Меняется только то, что является НАСТРОЙКОЙ САЙТА. Три места сознательно не
 * трогаются — они не настройки, и правка там сломала бы работающее:
 *
 *   • wp_fsmpt_email_logs — журнал уже отправленных писем. Это история: письмо
 *     действительно уходило на тот адрес, переписывать её нельзя.
 *   • wp_usermeta/wp_googlesitekit_profile и wp_elementor_connect_common_data —
 *     не почта сайта, а идентификаторы личных аккаунтов Google и Elementor, к
 *     которым сайт подключён. Смена строки здесь не переносит подключение на
 *     другой аккаунт, а рвёт его.
 *   • wp_options/fs_accounts — аккаунт Freemius (лицензии плагинов). Адрес там
 *     меняется на стороне Freemius, локальная правка только рассинхронизирует.
 *
 * Запуск (на сервере, из корня WordPress):
 *   /opt/php83/bin/php /tmp/wp-cli.phar eval "require '/tmp/fluent-support-agent-and-email.php';"
 */

use FluentSupport\App\Models\Agent;

global $wpdb;

$old = 'yk.intro@gmail.com';
$new = 'info@rentos365.app';

// --- 1. Профиль агента --------------------------------------------------
// Имя латиницей — решение владельца: поддержка отвечает клиентам на пяти языках
// сайта, и «Поддержка RentOS» читалась бы только частью из них.
$agent = Agent::find(1);
if ($agent) {
    $agent->first_name = 'Support';
    $agent->last_name  = 'RentOS';
    $agent->title      = 'Support Team';
    $agent->email      = $new;
    // Иконка RentOS растром, а не SVG: аватар подставляется и в письма, и в
    // почтовых клиентах SVG отображается далеко не везде.
    $agent->avatar     = 'https://rentos365.app/wp-content/uploads/2026/07/cropped-RentOs-favicon-192x192.png';
    $agent->save();
    echo "агент #1: «{$agent->first_name} {$agent->last_name}», {$agent->title}, {$agent->email}\n";
    echo "  аватар: {$agent->avatar}\n\n";
}

// --- 2. Учётная запись WordPress ---------------------------------------
// Логин остаётся прежним (yura_kr) — меняется только адрес.
$user = get_user_by('id', 1);
if ($user && $user->user_email === $old) {
    wp_update_user(['ID' => 1, 'user_email' => $new]);
    echo "wp_users #1: логин «{$user->user_login}» сохранён, почта → {$new}\n";
}

// --- 3. Служебные адреса WordPress -------------------------------------
// Оба сразу: иначе WordPress считает, что смена адреса «в процессе», и шлёт
// письмо с подтверждением на старый.
foreach (['admin_email', 'new_admin_email'] as $opt) {
    if (get_option($opt) === $old) {
        update_option($opt, $new);
        echo "опция {$opt} → {$new}\n";
    }
}

// --- 4. Адреса внутри настроек плагинов --------------------------------
// BetterDocs: адрес формы «Как мы можем помочь?» в документации.
$bd = get_option('betterdocs_settings');
if (is_array($bd) && ($bd['email_address'] ?? '') === $old) {
    $bd['email_address'] = $new;
    update_option('betterdocs_settings', $bd);
    echo "betterdocs_settings.email_address → {$new}\n";
}

// TranslatePress: куда уходит письмо об исчерпании лимита машинного перевода.
$trp = get_option('trp_machine_translation_settings');
if (is_array($trp) && ($trp['ai_words_notification_email'] ?? '') === $old) {
    $trp['ai_words_notification_email'] = $new;
    update_option('trp_machine_translation_settings', $trp);
    echo "trp_machine_translation_settings.ai_words_notification_email → {$new}\n";
}

// --- 5. FluentCart: запись покупателя ----------------------------------
// Заказ #2 проведён вручную (offline_payment, без идентификатора платежа у
// шлюза) — это и есть тот самый тест. Paddle знает покупателя по своему
// ctm_-идентификатору в мете, а не по адресу, поэтому смена почты здесь ничего
// не рассинхронизирует.
$n = $wpdb->update("{$wpdb->prefix}fct_customers", ['email' => $new], ['email' => $old]);
echo "fct_customers: {$n}\n";
$n = $wpdb->update("{$wpdb->prefix}fct_customer_addresses", ['email' => $new], ['email' => $old]);
echo "fct_customer_addresses: {$n}\n";
$n = $wpdb->update("{$wpdb->prefix}fct_carts", ['email' => $new], ['email' => $old]);
echo "fct_carts: {$n}\n";

// --- 6. Шаблон Elementor с закешированным выводом кабинета --------------
// В post_content шаблона «FluentCart — Customer Dashboard» лежит отрендеренный
// HTML ЛИЧНОГО кабинета владельца — с его именем и адресом. Elementor держит
// такой слепок рядом с настоящими данными виджета в _elementor_data. Сам по
// себе он перерисуется, но пока лежит — это чужой адрес в общем шаблоне.
$posts = $wpdb->get_results("SELECT ID FROM {$wpdb->posts} WHERE post_content LIKE '%{$old}%'");
foreach ($posts as $p) {
    $wpdb->query($wpdb->prepare(
        "UPDATE {$wpdb->posts} SET post_content = REPLACE(post_content, %s, %s) WHERE ID = %d",
        $old, $new, $p->ID
    ));
    echo "wp_posts #{$p->ID}: адрес заменён\n";
}

// --- 7. Индекс ссылок Yoast --------------------------------------------
// Производная таблица: mailto-ссылки, найденные Yoast в контенте.
$n = $wpdb->query($wpdb->prepare(
    "UPDATE {$wpdb->prefix}yoast_seo_links SET url = REPLACE(url, %s, %s) WHERE url LIKE %s",
    $old, $new, '%' . $wpdb->esc_like($old) . '%'
));
echo "yoast_seo_links: {$n}\n";

echo "\n--- что осталось со старым адресом (намеренно) ---\n";
foreach ([
    "{$wpdb->prefix}fsmpt_email_logs" => 'to',
    "{$wpdb->usermeta}"               => 'meta_value',
    "{$wpdb->options}"                => 'option_value',
] as $table => $col) {
    $c = (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$table}` WHERE `{$col}` LIKE '%{$old}%'");
    echo "  {$table}.{$col}: {$c}\n";
}
