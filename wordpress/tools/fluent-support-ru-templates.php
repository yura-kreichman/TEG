<?php
/**
 * Русские шаблоны писем Fluent Support для почтового ящика RentOS.
 *
 * Плагин отдаёт свои шаблоны только на английском (Settings::getDefaultEmailBody),
 * и до 2026-08-22 ни один из восьми не был переопределён — обратившемуся уходило
 * "An agent just replied to your ticket". Этот скрипт кладёт русские шаблоны в
 * meta почтового ящика тем же методом, каким их сохраняет админка плагина
 * (MailBox::saveMeta '_email_<key>'), поэтому ядро плагина не тронуто, обновления
 * проходят как обычно, а тексты остаются видимыми и редактируемыми в
 * Settings → Email Notifications.
 *
 * Русский здесь — БАЗОВЫЙ язык. Письма на остальных языках сайта подставляет
 * mu-plugin rentos-fluent-support-i18n.php поверх этих шаблонов.
 *
 * Терминология — «заявка», не «тикет» и не «обращение»: так называется раздел
 * кабинета и все подписи формы (см. mu-plugin rentos-fluent-support-form-i18n.php).
 *
 * Запуск (на сервере, из корня WordPress):
 *   /opt/php83/bin/php /tmp/wp-cli.phar eval "require '/tmp/fluent-support-ru-templates.php';"
 */

$box = FluentSupport\App\Models\MailBox::find(1);
if (!$box) {
    echo "Почтовый ящик 1 не найден\n";
    return;
}

// Тема писем клиенту намеренно оставлена как есть — 'Re: {{ticket.title}} #{{ticket.public_id}}'.
// Она состоит из слов самого обратившегося, переводить в ней нечего, а 'Re:' держит
// всю переписку одной цепочкой в почтовом клиенте.
$subjectToCustomer = 'Re: {{ticket.title}} #{{ticket.public_id}}';

// Цитата с ответом агента внутри письма.
$quote = 'border-left:3px solid #dcdcdc;padding:4px 0 4px 16px;margin:16px 0;';

$templates = [
    // Уходит клиенту сразу после создания заявки. У плагина выключено по
    // умолчанию — человек отправлял заявку и не получал вообще ничего, не понимая,
    // дошла ли. Включаем (решение владельца 2026-08-22).
    'ticket_created_email_to_customer' => [
        'status'  => 'yes',
        'subject' => $subjectToCustomer,
        'body'    => '<p>Здравствуйте, <strong>{{customer.first_name|коллега}}</strong>!</p>'
            . '<p>Мы получили вашу заявку «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) — она уже у службы поддержки.</p>'
            . '<h4><a href="{{ticket.public_url}}">Открыть заявку</a></h4>'
            . '<p>Ответ придёт на этот адрес. Если нужно что-то добавить — откройте заявку по ссылке выше.</p>'
            . '<hr /><p>С уважением,<br />{{business.name}}</p>',
    ],

    // Главное письмо: агент ответил. Текст ответа вставлен прямо в письмо
    // (решение владельца 2026-08-22) — раньше уходило только «агент ответил,
    // нажмите, чтобы посмотреть», и человеку приходилось идти на портал за
    // одной строчкой.
    'ticket_replied_by_agent_email_to_customer' => [
        'status'  => 'yes',
        'subject' => $subjectToCustomer,
        'body'    => '<p>Здравствуйте, <strong>{{customer.first_name|коллега}}</strong>!</p>'
            . '<p>По вашей заявке «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) пришёл ответ:</p>'
            . '<div style="' . $quote . '">{{response.full_content}}</div>'
            . '<h4><a href="{{ticket.public_url}}">Открыть заявку</a></h4>'
            . '<p>Чтобы ответить — откройте заявку по ссылке выше: так ответ попадёт в переписку и не потеряется.</p>'
            . '<hr /><p>С уважением,<br />{{business.name}}</p>',
    ],

    // Выключено у плагина, владелец оставил выключенным. Шаблон всё равно
    // переводим: если уведомление когда-нибудь включат из админки, английское
    // письмо не должно уйти клиенту незаметно.
    'ticket_closed_by_agent_email_to_customer' => [
        'status'  => 'no',
        'subject' => $subjectToCustomer,
        'body'    => '<p>Здравствуйте, <strong>{{customer.first_name|коллега}}</strong>!</p>'
            . '<p>Ваша заявка «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) закрыта.</p>'
            . '<p>Если вопрос остался, откройте заявку снова и напишите ответ.</p>'
            . '<h4><a href="{{ticket.public_url}}">Открыть заявку</a></h4>'
            . '<hr /><p>С уважением,<br />{{business.name}}</p>',
    ],

    // Тоже выключено, переводим по той же причине.
    'ticket_created_by_agent_email_to_customer' => [
        'status'  => 'no',
        'subject' => $subjectToCustomer,
        'body'    => '<p>Здравствуйте, <strong>{{customer.first_name|коллега}}</strong>!</p>'
            . '<p>Служба поддержки завела заявку «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) по вашему вопросу.</p>'
            . '<h4><a href="{{ticket.public_url}}">Открыть заявку</a></h4>'
            . '<hr /><p>С уважением,<br />{{business.name}}</p>',
    ],

    // А это уведомление ВКЛЮЧЕНО у плагина по умолчанию и уходит клиенту —
    // без перевода оно осталось бы единственным английским письмом наружу.
    'ticket_created_by_agent_on_behalf_email_to_customer' => [
        'status'  => 'yes',
        'subject' => 'Заявка создана (#{{ticket.public_id}})',
        'body'    => '<p>Здравствуйте, <strong>{{customer.first_name|коллега}}</strong>!</p>'
            . '<p>Служба поддержки завела для вас заявку «<strong>{{ticket.title}}</strong>» (#{{ticket.public_id}}):</p>'
            . '<div style="' . $quote . '">{{response.full_content}}</div>'
            . '<h4><a href="{{ticket.public_url}}">Открыть заявку</a></h4>'
            . '<hr /><p>С уважением,<br />{{business.name}}</p>',
    ],

    // Письма внутрь — агенту и администратору. Читает их владелец платформы,
    // русскоязычный; английские заголовки в почтовом ящике поддержки только
    // мешают глазом отличать одно письмо от другого.
    'ticket_created_email_to_admin' => [
        'status'  => 'yes',
        'subject' => 'Новая заявка: {{ticket.title}} #{{ticket.public_id}}',
        'body'    => '<p>Новая заявка <a href="{{ticket.admin_url}}">«{{ticket.title}}»</a> от {{customer.full_name}}.</p>'
            . '<h4>Текст заявки</h4><p>{{ticket.content}}</p>'
            . '<p><b><a href="{{ticket.admin_url}}">Открыть в админке</a></b></p>',
    ],
    'ticket_replied_by_customer_email_to_admin' => [
        'status'  => 'yes',
        'subject' => 'Новый ответ: {{ticket.title}} #{{ticket.public_id}}',
        'body'    => '<p>{{customer.full_name}} ответил(а) в заявке <a href="{{ticket.admin_url}}">«{{ticket.title}}»</a>.</p>'
            . '<h4>Текст ответа</h4><p>{{response.content}}</p>'
            . '<p><b><a href="{{ticket.admin_url}}">Открыть в админке</a></b></p>',
    ],
    'ticket_agent_on_change' => [
        'status'  => 'yes',
        'subject' => 'Заявка назначена вам: {{ticket.title}} #{{ticket.public_id}}',
        'body'    => '<p>Здравствуйте, <strong>{{agent.full_name}}</strong>!</p>'
            . '<p>На вас назначена заявка <a href="{{ticket.admin_url}}">«{{ticket.title}}» #{{ticket.public_id}}</a>.</p>',
    ],
];

foreach ($templates as $key => $tpl) {
    $box->saveMeta('_email_' . $key, [
        'key'              => $key,
        'email_subject'    => $tpl['subject'],
        'email_body'       => $tpl['body'],
        'status'           => $tpl['status'],
        'can_edit_subject' => 'yes',
        'send_attachments' => 'no',
    ]);
    echo "сохранено: {$key} (status={$tpl['status']})\n";
}
