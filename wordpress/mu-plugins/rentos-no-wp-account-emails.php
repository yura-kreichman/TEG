<?php
/**
 * Plugin Name: RentOS — без WP-писем о новом аккаунте
 * Description: FluentCart на каждой оплаченной подписке заводит покупателю WP-аккаунт
 *              (OrderPaid.php: для type=subscription это происходит всегда, в обход
 *              настройки user_account_creation_mode) и в конце регистрации дёргает
 *              do_action('register_new_user') — а он рассылает два письма: копию
 *              администратору и «Данные для входа на сайт» покупателю со ссылкой на
 *              wp-login.php. Покупателю в админке WordPress делать нечего: его кабинет —
 *              my.rentos365.app, и приглашение туда шлёт само приложение.
 *              Штатный фильтр плагина гасит оба письма; сам аккаунт продолжает
 *              создаваться — он нужен FluentCart, чтобы связать покупателя с заказами.
 */

add_filter('fluent_cart/user/after_register/skip_hooks', '__return_true');
