<?php
/**
 * Plugin Name: RentOS — удаление учётной записи по сигналу приложения
 * Description: Учётную запись на сайте заводит либо FluentCart при покупке, либо единый вход при
 *              первом заходе (роль rentos_client). При удалении кабинета в RentOS она оставалась
 *              здесь навсегда: сверять сотни адресов руками нереально, и мусор копился без предела.
 *              Приложение (src/lib/tenant-lifecycle.ts) зовёт этот адрес после успешного удаления
 *              кабинета, подписывая запрос тем же общим секретом, что и единый вход.
 *
 *              Решение «удалять или нет» принимается ЗДЕСЬ, а не в приложении: только сайт знает
 *              про заказы FluentCart, а удалить покупателя с историей покупок значило бы осиротить
 *              её (Customer ссылается на user_id). Тикеты Fluent Support не трогаются вовсе —
 *              переписка по возвратам и спорам может понадобиться и после закрытия кабинета
 *              (решение владельца 2026-08-10).
 */

add_action('init', function () {
    if (!isset($_GET['rentos_delete_account'])) {
        return;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_send_json_error(['message' => 'POST only'], 405);
    }

    $secret = defined('RENTOS_SSO_SECRET') ? (string) RENTOS_SSO_SECRET : '';
    if (!$secret) {
        wp_send_json_error(['message' => 'not configured'], 500);
    }

    $payload = json_decode(file_get_contents('php://input'), true);
    $email = is_array($payload) ? sanitize_email($payload['email'] ?? '') : '';
    $timestamp = is_array($payload) ? (string) ($payload['timestamp'] ?? '') : '';
    $signature = is_array($payload) ? (string) ($payload['signature'] ?? '') : '';

    if (!$email || !$timestamp || !$signature) {
        wp_send_json_error(['message' => 'bad request'], 400);
    }

    // Окно в пять минут: подписанный запрос, перехваченный однажды, нельзя
    // проиграть заново через неделю, когда человек успел вернуться и завести
    // кабинет снова.
    if (abs(time() - (int) round(((float) $timestamp) / 1000)) > 300) {
        wp_send_json_error(['message' => 'stale request'], 400);
    }

    $expected = hash_hmac('sha256', $email . ':' . $timestamp, $secret);
    if (!hash_equals($expected, $signature)) {
        wp_send_json_error(['message' => 'bad signature'], 403);
    }

    $user = get_user_by('email', $email);
    if (!$user) {
        // Идемпотентность: повторный сигнал по уже удалённому адресу — не ошибка.
        wp_send_json_success(['result' => 'absent']);
    }

    // Роль — единственный признак «эта запись существует только ради RentOS».
    // Администратора, автора или редактора не трогаем ни при каких условиях.
    if (!in_array('rentos_client', (array) $user->roles, true)) {
        wp_send_json_success(['result' => 'skipped_role', 'roles' => (array) $user->roles]);
    }

    $customer = class_exists('\FluentCart\App\Models\Customer')
        ? \FluentCart\App\Models\Customer::query()->where('email', $email)->first()
        : null;

    if ($customer && ($customer->orders()->count() > 0 || $customer->subscriptions()->count() > 0)) {
        wp_send_json_success(['result' => 'skipped_has_orders']);
    }

    require_once ABSPATH . 'wp-admin/includes/user.php';
    $deleted = wp_delete_user($user->ID);

    // Запись покупателя без единого заказа — та же сирота, что и сам
    // пользователь; с заказами сюда не доходим.
    if ($deleted && $customer) {
        $customer->delete();
    }

    wp_send_json_success(['result' => $deleted ? 'deleted' : 'failed']);
});
