<?php
/**
 * Plugin Name: RentOS — подписи формы заявки Fluent Support на языке посетителя
 * Description: Форма создания заявки в кабинете клиента была английской, хотя
 *              остальной портал русский. Причина не в переводах: Pro-часть в
 *              `app/Hooks/filters.php` делает
 *              `wp_parse_args($ticketFormConfig['field_labels'], $vars['i18n'])`,
 *              а wp_parse_args отдаёт приоритет ПЕРВОМУ аргументу — то есть
 *              английские подписи Pro перезаписывают уже переведённые строки
 *              бесплатной части. Языкового пакета у Pro-плагинов не существует
 *              (их нет на wp.org), плюс шесть подписей осели в базе
 *              (`wp_fs_meta`, ключ `_ticket_form_settings`) ещё до установки
 *              русского пакета, так что .mo их не догонит никогда.
 *
 *              Подставляем свои подписи через тот же штатный фильтр, но позже
 *              Pro. Язык берём из determine_locale(): TranslatePress переключает
 *              локаль по языку страницы, поэтому на /en/ и /ro/ подписи тоже
 *              будут верными — в отличие от правки значений в базе, где на все
 *              пять языков одно значение.
 *
 *              Подменяем ТОЛЬКО нетронутый английский дефолт: если владелец
 *              задал свой текст в панели, его текст и останется.
 *
 *              Терминология: «заявка», а не «тикет» — раздел кабинета
 *              называется «Заявки», и одно понятие должно называться одинаково.
 */

// Ключ => [английский дефолт, переводы]. Английский нужен как признак
// «настройку не трогали»: сравниваем с ним перед подменой.
const RENTOS_FS_FORM_LABELS = [
    'subject' => [
        'en' => 'Subject',
        'ru' => 'Тема',
        'uk' => 'Тема',
        'it' => 'Oggetto',
        'ro' => 'Subiect',
    ],
    'ticket_details' => [
        'en' => 'Ticket Details',
        'ru' => 'Описание заявки',
        'uk' => 'Опис заявки',
        'it' => 'Dettagli della richiesta',
        'ro' => 'Detaliile solicitării',
    ],
    'details_help' => [
        'en' => 'Please provide details about your problem',
        'ru' => 'Опишите, что случилось: чем подробнее, тем быстрее поможем',
        'uk' => 'Опишіть, що сталося: чим докладніше, тим швидше допоможемо',
        'it' => 'Descriva il problema: più dettagli, più rapido sarà l\'aiuto',
        'ro' => 'Descrieți problema: cu cât mai multe detalii, cu atât ajutăm mai repede',
    ],
    'product_services' => [
        'en' => 'Related Product/Service',
        'ru' => 'К чему относится',
        'uk' => 'До чого належить',
        'it' => 'A cosa si riferisce',
        'ro' => 'La ce se referă',
    ],
    'priority' => [
        'en' => 'Priority',
        'ru' => 'Приоритет',
        'uk' => 'Пріоритет',
        'it' => 'Priorità',
        'ro' => 'Prioritate',
    ],
    'btn_text' => [
        'en' => 'Create Ticket',
        'ru' => 'Создать заявку',
        'uk' => 'Створити заявку',
        'it' => 'Invia richiesta',
        'ro' => 'Trimite solicitarea',
    ],
    'submit_heading' => [
        'en' => 'Submit a Support Ticket',
        'ru' => 'Новая заявка в поддержку',
        'uk' => 'Нова заявка в підтримку',
        'it' => 'Nuova richiesta di assistenza',
        'ro' => 'Solicitare nouă către suport',
    ],
    'create_ticket_cta' => [
        'en' => 'Create Ticket',
        'ru' => 'Создать заявку',
        'uk' => 'Створити заявку',
        'it' => 'Invia richiesta',
        'ro' => 'Trimite solicitarea',
    ],
];

/**
 * Локаль WordPress → короткий код языка сайта.
 */
function rentos_fs_form_lang() {
    $locale = determine_locale();

    if (strpos($locale, 'ru') === 0) {
        return 'ru';
    }
    if (strpos($locale, 'uk') === 0) {
        return 'uk';
    }
    if (strpos($locale, 'it') === 0) {
        return 'it';
    }
    if (strpos($locale, 'ro') === 0) {
        return 'ro';
    }

    return 'en';
}

/**
 * Единая терминология: «заявка», а не «тикет».
 *
 * Русский пакет плагина сам себе противоречит: «Tickets» переведено как
 * «Заявки», а «Ticket» — как «Тикет», и на одном экране рядом оказывались
 * «Создать заявку» и «Назад ко всем тикетам». Заодно переписаны две фразы,
 * которые в пакете звучат машинно.
 *
 * Только для русского: для остальных языков пакета Fluent Support не существует
 * (Pro-плагинов нет на wp.org), там строки английские, и подменять их нечем.
 */
const RENTOS_FS_TICKET_WORDING = [
    'All Tickets'              => 'Все заявки',
    'Back to All Tickets'      => 'Назад ко всем заявкам',
    'Close Ticket'             => 'Закрыть заявку',
    'Reopen This ticket'       => 'Открыть заявку снова',
    'Ticket'                   => 'Заявка',
    'created_ticket_on_behalf' => 'создал эту заявку от вашего имени',
    'customer_inactive_message' => 'Ваш аккаунт неактивен: создавать новые заявки и отвечать на существующие нельзя. Напишите администратору сайта.',
    'reopen_ticket_instruction' => 'Если вопрос остался, откройте заявку снова и напишите ответ.',
];

// Приоритет 20: Pro-часть подставляет свои подписи на стандартной 10, наши
// должны лечь поверх.
add_filter('fluent_support/customer_portal_vars', function ($vars) {
    if (empty($vars['i18n']) || !is_array($vars['i18n'])) {
        return $vars;
    }

    $lang = rentos_fs_form_lang();

    foreach (RENTOS_FS_FORM_LABELS as $key => $variants) {
        if (!isset($vars['i18n'][$key])) {
            continue;
        }
        // Не свой текст владельца — только английский дефолт.
        if ($vars['i18n'][$key] !== $variants['en']) {
            continue;
        }
        $vars['i18n'][$key] = $variants[$lang] ?? $variants['en'];
    }

    if ($lang === 'ru') {
        foreach (RENTOS_FS_TICKET_WORDING as $key => $text) {
            if (isset($vars['i18n'][$key])) {
                $vars['i18n'][$key] = $text;
            }
        }
    }

    return $vars;
}, 20);
