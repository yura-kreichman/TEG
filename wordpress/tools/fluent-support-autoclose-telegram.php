<?php
/**
 * 1. Автозакрытие заявок по бездействию — ШТАТНАЯ функция Fluent Support Pro
 *    (Settings → Auto Close), которую я сначала ошибочно объявил отсутствующей:
 *    искал триггер по времени среди автоматизаций, а он живёт отдельно, в
 *    AutoCloseService, и запускается часовым обработчиком fluent_support_hourly_tasks.
 *
 * 2. Telegram-чат агента поддержки.
 *
 * Запуск (на сервере, из корня WordPress):
 *   /opt/php83/bin/php /tmp/wp-cli.phar eval "require '/tmp/fluent-support-autoclose-telegram.php';"
 */

use FluentSupport\App\Models\Agent;
use FluentSupport\App\Services\Helper;
use FluentSupportPro\App\Services\AutoCloseService;

// --- Автозакрытие -------------------------------------------------------
$settings = AutoCloseService::getSettings();

$settings['enabled'] = 'yes';
// 5 дней (решение владельца). Закрывается только заявка, в которой ПОСЛЕДНИМ
// говорил агент (см. exclude_if_customer_waiting ниже), то есть человек получил
// ответ и не вернулся. Пять дней тишины после ответа — разговор закончен.
$settings['inactive_days'] = 5;
// Главная защита: не закрывать то, где ждут НАС. Запрос выбирает только заявки с
// last_customer_response < last_agent_response, а статус 'new' (заявка, на
// которую вообще не ответили) исключён в самом сервисе — такую не закроет никогда.
$settings['exclude_if_customer_waiting'] = 'yes';
// Без рассылки событий: письмо «заявка закрыта» у нас выключено, и поднимать
// шум по закрытию давно молчащих заявок незачем.
$settings['close_silently'] = 'yes';
// Но след в переписке оставляем — иначе заявка закрывается молча и человек,
// вернувшийся через месяц, не понимает, что произошло.
$settings['add_close_response'] = 'yes';
$settings['close_response_body'] = '<p>Здравствуйте, {{customer.first_name|коллега}}!</p>'
    . '<p>По этой заявке давно не было новостей, поэтому мы её закрываем.</p>'
    . '<p>Если вопрос остался — откройте заявку снова и напишите нам, она сразу станет активной.</p>';
$settings['closed_by_agent'] = 1;

AutoCloseService::saveSettings($settings);

echo "автозакрытие: включено, {$settings['inactive_days']} дн. бездействия\n";
echo "  заявки, где ждут ответа от нас — не закрываются\n";
echo "  заявки без единого ответа (статус «новая») — не закрываются\n\n";

// --- Telegram-чат агента ------------------------------------------------
// Тот же чат, что в глобальных настройках. На поведение сегодня это не влияет:
// getApiClient() подставляет чат агента ВМЕСТО глобального, а не вдобавок к
// нему, — дублей в группе не будет.
// ВНИМАНИЕ: telegram_settings лежит в wp_fs_meta с object_type='integration_settings',
// а не 'option' — Helper::getOption() его не видит и молча возвращает пустоту.
global $wpdb;
$row = $wpdb->get_row("SELECT value FROM {$wpdb->prefix}fs_meta WHERE `key`='telegram_settings' AND object_type='integration_settings'");
$telegram = $row ? maybe_unserialize($row->value) : [];
$chatId = $telegram['chat_id'] ?? '';

$agent = Agent::find(1);
if ($agent && $chatId) {
    $agent->updateMeta('telegram_chat_id', $chatId);
    echo "агент #1: telegram_chat_id = {$chatId}\n";
    echo "  проверка чтения: " . var_export($agent->getMeta('telegram_chat_id'), true) . "\n";
} else {
    echo "не удалось: агент или chat_id не найдены\n";
}
