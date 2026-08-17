<?php
/**
 * Plugin Name: RentOS — кнопки шапки для вошедших
 * Description: Для вошедшего посетителя «Войти» становится «Выход», «Регистрация» — «Кабинет».
 *              Вход на сайт бывает только по SSO из приложения RentOS (роль rentos_client),
 *              то есть сессия WordPress существует и условие is_user_logged_in() работает.
 *              Второе меню не заводим: разметка кнопок лежит в самих пунктах и правится вручную,
 *              держать её в двух местах — гарантированное расхождение. Подменяем текст и ссылку.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * ID пунктов главного меню с HTML-разметкой кнопок.
 * 1180 — «Войти» (контурная), 1179 — «Регистрация» (заливка).
 */
function rentos_hab_map() {
	return [
		1180 => [
			'from' => 'Войти',
			'to'   => 'Выход',
			'url'  => null,          // подставляется чистый /logout/, см. ниже
		],
		1179 => [
			'from' => 'Регистрация',
			'to'   => 'Кабинет',
			'url'  => 'https://my.rentos365.app',
		],
	];
}

/**
 * Заменяем только текст внутри разметки, сами теги и стили не трогаем.
 */
function rentos_hab_replace_label( $title, $from, $to ) {
	if ( false !== strpos( $title, '>' . $from . '<' ) ) {
		return str_replace( '>' . $from . '<', '>' . $to . '<', $title );
	}

	return ( trim( $title ) === $from ) ? $to : $title;
}

/**
 * Чистый адрес выхода вместо wp-login.php с nonce и redirect_to.
 * Владелец подтвердил размен: ссылка короткая и без следов движка, ценой того, что nonce
 * больше не защищает от постороннего «разлогинивания» (данные при этом не страдают).
 *
 * Языковой префикс НЕ добавляем руками: TranslatePress уже подмешивает его в home_url(),
 * и своя добавка давала /en/en/ (поймано на проверке).
 */
function rentos_hab_logout_url() {
	return home_url( '/logout/' );
}

/**
 * Обработчик /logout/ — и с языковым префиксом тоже. Правила перезаписи не трогаем:
 * запрос всё равно доходит до template_redirect, а сбрасывать rewrite-правила на живом
 * сайте рискованнее, чем разобрать путь вручную.
 */
function rentos_hab_handle_logout() {
	$path = trim( (string) parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );

	if ( ! preg_match( '#(^|/)logout$#', $path ) ) {
		return;
	}

	if ( is_user_logged_in() ) {
		wp_logout();
	}

	nocache_headers();
	wp_safe_redirect( home_url( '/' ), 302 );   // язык подставит TranslatePress
	exit;
}
add_action( 'template_redirect', 'rentos_hab_handle_logout', 1 );

/**
 * Адрес запуска единого входа — тот же, что у кнопки «Войти через RentOS»
 * (сниппет «RentOS: единый вход и роль клиента»). Функция сниппета в приоритете:
 * если её однажды переделают, шапка поедет вместе с ней, а не разойдётся.
 *
 * `to` — страница, на которой человек нажал кнопку: после входа он вернётся
 * именно сюда, а не окажется в кабинете приложения.
 */
function rentos_hab_login_url() {
	// Языковой префикс уже стоит в адресе текущей страницы, а home_url() на переведённой
	// странице добавляет его ВТОРОЙ раз (TranslatePress фильтрует home_url) — получалось
	// /ua/ua/ и возврат после входа на 404. Берём от домена только схему и хост.
	$home = wp_parse_url( home_url( '/' ) );
	$back = $home['scheme'] . '://' . $home['host'] . add_query_arg( null, null );

	if ( function_exists( 'rentos_sso_start_url' ) ) {
		return rentos_sso_start_url( $back );
	}

	return add_query_arg( [ 'rentos_sso' => 'start', 'to' => rawurlencode( $back ) ], home_url( '/' ) );
}

function rentos_hab_swap( $items, $args ) {
	if ( is_admin() ) {
		return $items;
	}

	// Гость: «Вход» ведёт не в приложение, а в единый вход. Кто уже вошёл
	// в кабинет — вернётся на сайт уже авторизованным, ничего не вводя;
	// кто нет — увидит экран входа приложения и после него вернётся сюда же.
	// Раньше кнопка вела на my.rentos365.app и просто высаживала человека
	// в кабинете, а сайт о его входе так и не узнавал.
	if ( ! is_user_logged_in() ) {
		foreach ( $items as $item ) {
			if ( 1180 === (int) $item->ID ) {
				$item->url    = rentos_hab_login_url();
				$item->target = '';
			}
		}

		return $items;
	}

	$map = rentos_hab_map();

	foreach ( $items as $item ) {
		if ( ! isset( $map[ (int) $item->ID ] ) ) {
			continue;
		}

		$rule = $map[ (int) $item->ID ];
		$item->title = rentos_hab_replace_label( $item->title, $rule['from'], $rule['to'] );

		if ( null === $rule['url'] ) {
			// выход с сайта; сессия в приложении остаётся своей и не трогается
			$item->url = rentos_hab_logout_url();
			$item->target = '';
		} else {
			$item->url = $rule['url'];
		}
	}

	return $items;
}
add_filter( 'wp_nav_menu_objects', 'rentos_hab_swap', 20, 2 );
