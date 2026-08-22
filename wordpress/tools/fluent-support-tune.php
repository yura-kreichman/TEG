<?php
/**
 * Донастройка Fluent Support под реальную работу поддержки (решения владельца 2026-08-22).
 *
 * Всё через штатные механизмы плагина — Settings::save() и его же модели Workflow/Agent.
 * Ядро не правится, обновления проходят как обычно.
 *
 * Запуск (на сервере, из корня WordPress):
 *   /opt/php83/bin/php /tmp/wp-cli.phar eval "require '/tmp/fluent-support-tune.php';"
 */

use FluentSupport\App\Models\Agent;
use FluentSupport\App\Services\Helper;
use FluentSupport\App\Services\EmailNotification\Settings;
use FluentSupportPro\App\Models\Workflow;
use FluentSupportPro\App\Models\WorkflowAction;

$settings = Helper::getOption('global_business_settings', []);

$changes = [
    // 2 МБ не хватает на скриншот с телефона (3–6 МБ) — клиент физически не мог
    // приложить то, что у него просят. Сервер разрешает 512 МБ, упиралось только
    // в эту настройку.
    'max_file_size'            => 10,
    // Было «удалять вложения при закрытии заявки»: закрыли — и приложенные
    // клиентом скриншоты стёрты с диска, разбирать спорный случай потом нечем.
    'del_files_on_close'       => 'no',
    // Оценка ответа клиентом (Pro): раз поддержка выходит на поток, качество
    // ответов должно быть измеримо, а не на ощущение.
    'agent_feedback_rating'    => 'yes',
    // Счётчик открытых заявок в админ-баре и горячие клавиши — для агента,
    // который сидит в поддержке каждый день.
    'enable_admin_bar_summary' => 'yes',
    'keyboard_shortcuts'       => 'yes',
    // Нумерация с 1000. Префикс НЕ ставим сознательно: getTicketPrefix()
    // подмешивается только в интерфейсе, а подстановка {{ticket.public_id}} в
    // письмах отдаёт голый номер (display_ticket_number). С префиксом письмо и
    // админка показывали бы клиенту разные номера одной заявки.
    'enable_min_serial_number' => 'yes',
    'ticket_prefix'            => '',
    'min_serial_number'        => 1000,
];

foreach ($changes as $key => $value) {
    $old = $settings[$key] ?? '(нет)';
    $settings[$key] = $value;
    echo "  {$key}: {$old} → {$value}\n";
}

// Штатный путь сохранения — он же дочищает accepted_file_types, зажимает
// min_serial_number и синхронизирует внутренние уведомления.
(new Settings())->save('global_business_settings', $settings);
echo "настройки сохранены\n\n";

// --- Имя агента ---------------------------------------------------------
// Было пусто: {{agent.full_name}} подставлял пустоту, в переписке ответ шёл без
// подписи. Нейтральное «Поддержка RentOS», а не выдуманное имя человека —
// владелец поменяет на своё одним полем в профиле агента, если захочет.
$agent = Agent::find(1);
if ($agent && !trim($agent->first_name . $agent->last_name)) {
    $agent->first_name = 'Поддержка';
    $agent->last_name  = 'RentOS';
    $agent->save();
    echo "имя агента: «{$agent->first_name} {$agent->last_name}»\n\n";
} else {
    echo "имя агента уже заполнено — не трогаю\n\n";
}

// --- Автоматизация: назначать новые заявки на агента ---------------------
// Единственная автоматизация, которая здесь честно окупается: агент один,
// а заявка без назначенного агента висит в «неразобранных» и не попадает в
// личную очередь. Условий нет намеренно — пустая ГРУППА условий в
// ConditionChecker вернула бы false и заблокировала запуск, поэтому именно
// пустой список групп.
$title = 'Новая заявка — назначить на агента';

if (Workflow::where('title', $title)->first()) {
    echo "автоматизация «{$title}» уже есть — пропускаю\n";
} else {
    $workflow = Workflow::create([
        'title'        => $title,
        'trigger_key'  => 'fluent_support/ticket_created',
        'trigger_type' => 'automatic',
        'settings'     => ['conditions' => []],
    ]);

    // Модель принудительно ставит статус draft при создании — публикуем отдельно.
    $workflow->status = 'published';
    $workflow->save();

    WorkflowAction::create([
        'workflow_id' => $workflow->id,
        'action_name' => 'fs_action_assign_agent',
        'title'       => 'Назначить агента',
        'settings'    => ['agent_id' => 1],
    ]);

    echo "автоматизация #{$workflow->id} «{$title}» создана и опубликована\n";
}
