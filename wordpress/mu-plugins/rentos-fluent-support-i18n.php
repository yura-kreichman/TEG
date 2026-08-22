<?php
/**
 * Plugin Name: RentOS — письма Fluent Support на языке обратившегося
 * Description: Fluent Support держит РОВНО ОДИН шаблон письма на событие (meta почтового
 *              ящика `_email_<key>`), и никакой мультиязычности у него нет. В этой meta лежит
 *              русский текст — базовый язык сайта. Этот mu-plugin подменяет шаблон на лету,
 *              если человек, которому письмо адресовано, пользуется сайтом на другом языке.
 *
 *              Ядро плагина НЕ ПРАВИТСЯ — только его же публичные фильтры
 *              (`fluent_support/parse_smartcode_data`, `fluent_support/ticket_email_subject`),
 *              поэтому обновления Fluent Support проходят как обычно. Русские шаблоны при этом
 *              остаются видимыми и редактируемыми в Settings → Email Notifications: правка
 *              русского текста через админку работает, переводы живут здесь.
 *
 *              Переводится ТОЛЬКО обвязка письма. Сам ответ агента ({{response.full_content}})
 *              уходит на том языке, на котором агент его написал — машинного перевода
 *              переписки здесь нет и не предполагается.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Языки сайта = языки TranslatePress (publish-languages): ru_RU, en_US, uk, it_IT, ro_RO.
 * Русский базовый и в этой таблице отсутствует намеренно: для него шаблон берётся из
 * настроек плагина как есть, и никакой подмены не происходит вовсе.
 */
function rentos_fs_i18n_templates()
{
    $quote = 'border-left:3px solid #dcdcdc;padding:4px 0 4px 16px;margin:16px 0;';

    return [
        'en' => [
            'ticket_created_email_to_customer' => [
                'body' => '<p>Hello, <strong>{{customer.first_name|there}}</strong>!</p>'
                    . '<p>We have received your ticket &ldquo;<strong>{{ticket.title}}</strong>&rdquo; (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) — it is already with our support team.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Open ticket</a></h4>'
                    . '<p>We will reply to this address. There is no need to reply to this email — to add anything, open the ticket using the link above.</p>'
                    . '<hr /><p>Best regards,<br />{{business.name}}</p>',
            ],
            'ticket_replied_by_agent_email_to_customer' => [
                'body' => '<p>Hello, <strong>{{customer.first_name|there}}</strong>!</p>'
                    . '<p>There is a reply to your ticket &ldquo;<strong>{{ticket.title}}</strong>&rdquo; (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Open ticket</a></h4>'
                    . '<p>To answer, open the ticket using the link above. Please do not reply to this email — a reply by email will not reach your ticket.</p>'
                    . '<hr /><p>Best regards,<br />{{business.name}}</p>',
            ],
            'ticket_closed_by_agent_email_to_customer' => [
                'body' => '<p>Hello, <strong>{{customer.first_name|there}}</strong>!</p>'
                    . '<p>Your ticket &ldquo;<strong>{{ticket.title}}</strong>&rdquo; (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) has been closed.</p>'
                    . '<p>If the question is still open, write to us in the ticket and it will become active again.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Open ticket</a></h4>'
                    . '<hr /><p>Best regards,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_email_to_customer' => [
                'body' => '<p>Hello, <strong>{{customer.first_name|there}}</strong>!</p>'
                    . '<p>Our support team has opened the ticket &ldquo;<strong>{{ticket.title}}</strong>&rdquo; (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) about your question.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Open ticket</a></h4>'
                    . '<hr /><p>Best regards,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_on_behalf_email_to_customer' => [
                'subject' => 'Your ticket has been created (#{{ticket.public_id}})',
                'body'    => '<p>Hello, <strong>{{customer.first_name|there}}</strong>!</p>'
                    . '<p>Our support team has opened a ticket for you — &ldquo;<strong>{{ticket.title}}</strong>&rdquo; (#{{ticket.public_id}}):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Open ticket</a></h4>'
                    . '<hr /><p>Best regards,<br />{{business.name}}</p>',
            ],
        ],

        'uk' => [
            'ticket_created_email_to_customer' => [
                'body' => '<p>Вітаємо, <strong>{{customer.first_name|колего}}</strong>!</p>'
                    . '<p>Ми отримали вашу заявку «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) — вона вже у службі підтримки.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Відкрити заявку</a></h4>'
                    . '<p>Відповідь надійде на цю адресу. Відповідати на лист не потрібно — щоб щось додати, відкрийте заявку за посиланням вище.</p>'
                    . '<hr /><p>З повагою,<br />{{business.name}}</p>',
            ],
            'ticket_replied_by_agent_email_to_customer' => [
                'body' => '<p>Вітаємо, <strong>{{customer.first_name|колего}}</strong>!</p>'
                    . '<p>На вашу заявку «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) надійшла відповідь:</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Відкрити заявку</a></h4>'
                    . '<p>Щоб відповісти, відкрийте заявку за посиланням вище. На сам лист відповідати не потрібно — така відповідь до заявки не потрапить.</p>'
                    . '<hr /><p>З повагою,<br />{{business.name}}</p>',
            ],
            'ticket_closed_by_agent_email_to_customer' => [
                'body' => '<p>Вітаємо, <strong>{{customer.first_name|колего}}</strong>!</p>'
                    . '<p>Вашу заявку «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) закрито.</p>'
                    . '<p>Якщо питання лишилося — напишіть нам у заявці, і вона знову стане активною.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Відкрити заявку</a></h4>'
                    . '<hr /><p>З повагою,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_email_to_customer' => [
                'body' => '<p>Вітаємо, <strong>{{customer.first_name|колего}}</strong>!</p>'
                    . '<p>Служба підтримки створила заявку «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) за вашим питанням.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Відкрити заявку</a></h4>'
                    . '<hr /><p>З повагою,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_on_behalf_email_to_customer' => [
                'subject' => 'Заявку створено (#{{ticket.public_id}})',
                'body'    => '<p>Вітаємо, <strong>{{customer.first_name|колего}}</strong>!</p>'
                    . '<p>Служба підтримки створила для вас заявку «<strong>{{ticket.title}}</strong>» (#{{ticket.public_id}}):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Відкрити заявку</a></h4>'
                    . '<hr /><p>З повагою,<br />{{business.name}}</p>',
            ],
        ],

        'it' => [
            'ticket_created_email_to_customer' => [
                'body' => '<p>Buongiorno, <strong>{{customer.first_name|gentile cliente}}</strong>!</p>'
                    . '<p>Abbiamo ricevuto la tua richiesta «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>): è già in carico al nostro supporto.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Apri la richiesta</a></h4>'
                    . '<p>Risponderemo a questo indirizzo. Non è necessario rispondere a questa email: per aggiungere qualcosa, apri la richiesta dal link qui sopra.</p>'
                    . '<hr /><p>Cordiali saluti,<br />{{business.name}}</p>',
            ],
            'ticket_replied_by_agent_email_to_customer' => [
                'body' => '<p>Buongiorno, <strong>{{customer.first_name|gentile cliente}}</strong>!</p>'
                    . '<p>È arrivata una risposta alla tua richiesta «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Apri la richiesta</a></h4>'
                    . '<p>Per rispondere apri la richiesta dal link qui sopra. Non rispondere a questa email: la risposta non arriverebbe nella richiesta.</p>'
                    . '<hr /><p>Cordiali saluti,<br />{{business.name}}</p>',
            ],
            'ticket_closed_by_agent_email_to_customer' => [
                'body' => '<p>Buongiorno, <strong>{{customer.first_name|gentile cliente}}</strong>!</p>'
                    . '<p>La tua richiesta «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) è stata chiusa.</p>'
                    . '<p>Se la questione è ancora aperta, scrivici nella richiesta e tornerà attiva.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Apri la richiesta</a></h4>'
                    . '<hr /><p>Cordiali saluti,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_email_to_customer' => [
                'body' => '<p>Buongiorno, <strong>{{customer.first_name|gentile cliente}}</strong>!</p>'
                    . '<p>Il nostro supporto ha aperto la richiesta «<strong>{{ticket.title}}</strong>» (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) sulla tua domanda.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Apri la richiesta</a></h4>'
                    . '<hr /><p>Cordiali saluti,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_on_behalf_email_to_customer' => [
                'subject' => 'La tua richiesta è stata creata (#{{ticket.public_id}})',
                'body'    => '<p>Buongiorno, <strong>{{customer.first_name|gentile cliente}}</strong>!</p>'
                    . '<p>Il nostro supporto ha aperto per te la richiesta «<strong>{{ticket.title}}</strong>» (#{{ticket.public_id}}):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Apri la richiesta</a></h4>'
                    . '<hr /><p>Cordiali saluti,<br />{{business.name}}</p>',
            ],
        ],

        'ro' => [
            'ticket_created_email_to_customer' => [
                'body' => '<p>Bună ziua, <strong>{{customer.first_name|stimate client}}</strong>!</p>'
                    . '<p>Am primit solicitarea dumneavoastră „<strong>{{ticket.title}}</strong>” (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) — este deja la echipa de suport.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Deschideți solicitarea</a></h4>'
                    . '<p>Vă vom răspunde la această adresă. Nu este nevoie să răspundeți la acest e-mail — pentru a adăuga ceva, deschideți solicitarea din linkul de mai sus.</p>'
                    . '<hr /><p>Cu stimă,<br />{{business.name}}</p>',
            ],
            'ticket_replied_by_agent_email_to_customer' => [
                'body' => '<p>Bună ziua, <strong>{{customer.first_name|stimate client}}</strong>!</p>'
                    . '<p>Ați primit un răspuns la solicitarea „<strong>{{ticket.title}}</strong>” (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Deschideți solicitarea</a></h4>'
                    . '<p>Pentru a răspunde, deschideți solicitarea din linkul de mai sus. Nu răspundeți la acest e-mail: răspunsul nu ar ajunge în solicitare.</p>'
                    . '<hr /><p>Cu stimă,<br />{{business.name}}</p>',
            ],
            'ticket_closed_by_agent_email_to_customer' => [
                'body' => '<p>Bună ziua, <strong>{{customer.first_name|stimate client}}</strong>!</p>'
                    . '<p>Solicitarea dumneavoastră „<strong>{{ticket.title}}</strong>” (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) a fost închisă.</p>'
                    . '<p>Dacă întrebarea a rămas, scrieți-ne în solicitare și aceasta va redeveni activă.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Deschideți solicitarea</a></h4>'
                    . '<hr /><p>Cu stimă,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_email_to_customer' => [
                'body' => '<p>Bună ziua, <strong>{{customer.first_name|stimate client}}</strong>!</p>'
                    . '<p>Echipa de suport a deschis solicitarea „<strong>{{ticket.title}}</strong>” (<a href="{{ticket.public_url}}">#{{ticket.public_id}}</a>) pentru întrebarea dumneavoastră.</p>'
                    . '<h4><a href="{{ticket.public_url}}">Deschideți solicitarea</a></h4>'
                    . '<hr /><p>Cu stimă,<br />{{business.name}}</p>',
            ],
            'ticket_created_by_agent_on_behalf_email_to_customer' => [
                'subject' => 'Solicitarea a fost creată (#{{ticket.public_id}})',
                'body'    => '<p>Bună ziua, <strong>{{customer.first_name|stimate client}}</strong>!</p>'
                    . '<p>Echipa de suport a deschis pentru dumneavoastră solicitarea „<strong>{{ticket.title}}</strong>” (#{{ticket.public_id}}):</p>'
                    . '<div style="' . $quote . '">{{response.full_content}}</div>'
                    . '<h4><a href="{{ticket.public_url}}">Deschideți solicitarea</a></h4>'
                    . '<hr /><p>Cu stimă,<br />{{business.name}}</p>',
            ],
        ],
    ];
}

/** Локаль вида ru_RU / en_US / uk → короткий ключ таблицы выше. */
function rentos_fs_i18n_short_code($locale)
{
    $locale = (string) $locale;
    if ($locale === '') {
        return '';
    }
    return strtolower(substr(str_replace('-', '_', $locale), 0, 2));
}

/**
 * На каком языке писать этому обратившемуся.
 *
 * Порядок источников — от самого точного к самому общему:
 *  1. Язык страницы, с которой человек отправил обращение. Пишется в ticket_meta при
 *     создании (см. ниже) — это ровно то, чем он пользовался в тот момент.
 *  2. Предпочтительный язык учётной записи из TranslatePress (usermeta `trp_language`,
 *     ставится при регистрации и в профиле).
 *  3. Язык самого WordPress-профиля.
 *  4. Пусто — значит базовый русский, подмены не будет.
 */
function rentos_fs_i18n_language_for_ticket($ticket)
{
    global $wpdb;

    if (!$ticket || empty($ticket->id)) {
        return '';
    }

    $stored = $wpdb->get_var($wpdb->prepare(
        "SELECT value FROM {$wpdb->prefix}fs_meta WHERE object_type = 'ticket_meta' AND object_id = %d AND `key` = '_rentos_lang' LIMIT 1",
        $ticket->id
    ));
    if ($stored) {
        return rentos_fs_i18n_short_code($stored);
    }

    $customer = $ticket->customer ?? null;
    $userId = $customer && !empty($customer->user_id) ? (int) $customer->user_id : 0;
    if (!$userId) {
        return '';
    }

    $preferred = get_user_meta($userId, 'trp_language', true);
    if ($preferred) {
        return rentos_fs_i18n_short_code($preferred);
    }

    return rentos_fs_i18n_short_code(get_user_meta($userId, 'locale', true));
}

/**
 * Запоминаем язык страницы в момент создания обращения. `$TRP_LANGUAGE` — собственная
 * глобальная переменная TranslatePress (includes/class-language-switcher.php), она
 * выставлена на любом фронтовом запросе. Строка живёт в его же таблице meta с типом
 * `ticket_meta`, который Fluent Support сам подчищает при удалении тикета
 * (app/Models/Ticket.php), — сирот после себя не оставляем.
 */
add_action('fluent_support/ticket_created', function ($ticket) {
    if (!$ticket || empty($ticket->id) || !isset($GLOBALS['TRP_LANGUAGE'])) {
        return;
    }

    $language = (string) $GLOBALS['TRP_LANGUAGE'];
    if ($language === '') {
        return;
    }

    global $wpdb;
    $table = $wpdb->prefix . 'fs_meta';

    $exists = $wpdb->get_var($wpdb->prepare(
        "SELECT id FROM {$table} WHERE object_type = 'ticket_meta' AND object_id = %d AND `key` = '_rentos_lang' LIMIT 1",
        $ticket->id
    ));
    if ($exists) {
        return;
    }

    $wpdb->insert($table, [
        'object_type' => 'ticket_meta',
        'object_id'   => $ticket->id,
        'key'         => '_rentos_lang',
        'value'       => $language,
        'created_at'  => current_time('mysql'),
        'updated_at'  => current_time('mysql'),
    ]);
}, 10, 1);

/**
 * Подмена ТЕЛА письма. Фильтр `fluent_support/parse_smartcode_data` общий на весь плагин,
 * поэтому отсекаем всё лишнее:
 *  - `email_type` есть только у писем (parseEmailBody), не у разбора шаблонов ответов;
 *  - у подвала письма в `$data` уже лежит готовый `email_body` — по его отсутствию
 *    отличаем первый вызов (тело) от второго (подвал).
 * Приоритет 5 — до штатного разбора подстановок на 10, чтобы плагин подставлял значения
 * уже в переведённый текст.
 */
add_filter('fluent_support/parse_smartcode_data', function ($template, $data) {
    if (!is_array($data) || empty($data['email_type']) || array_key_exists('email_body', $data)) {
        return $template;
    }

    $translations = rentos_fs_i18n_templates();
    $language = rentos_fs_i18n_language_for_ticket($data['ticket'] ?? null);

    if (!$language || empty($translations[$language][$data['email_type']]['body'])) {
        return $template;
    }

    return $translations[$language][$data['email_type']]['body'];
}, 5, 2);

/**
 * Подмена ТЕМЫ. Переводится ровно одна: у остальных писем клиенту тема — это
 * 'Re: {{ticket.title}} #{{ticket.public_id}}', то есть слова самого обратившегося, переводить
 * в ней нечего.
 */
add_filter('fluent_support/ticket_email_subject', function ($subject, $ticket, $emailType) {
    $translations = rentos_fs_i18n_templates();
    $language = rentos_fs_i18n_language_for_ticket($ticket);

    if (!$language || empty($translations[$language][$emailType]['subject'])) {
        return $subject;
    }

    // Тему плагин разбирает ДО этого фильтра, поэтому подстановки в переводе
    // раскрываем сами — иначе в письмо ушло бы сырое '{{ticket.public_id}}'.
    return str_replace(
        ['{{ticket.public_id}}', '{{ticket.title}}'],
        [$ticket->id, $ticket->title],
        $translations[$language][$emailType]['subject']
    );
}, 10, 3);
