<?php
/**
 * Plugin Name: RentOS — доступность
 * Description: Мелкие правки доступности в чужой разметке, которых нет в настройках плагинов.
 *              Сейчас одна: подпись переключателя языка.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Переключатель TranslatePress показывает короткий код («RU»), а `aria-label` у него —
 * «Сменить язык». Для программ чтения с экрана это разные названия одного элемента, и правило
 * `label-content-name-mismatch` справедливо ругается: пользователь голосового управления скажет
 * «нажми RU», а такого элемента для системы не существует.
 *
 * Подпись приходит из gettext-строки плагина, поэтому чиним фильтром перевода, не трогая ядро:
 * дописываем к ней тот самый код языка. Код берём из слагов TranslatePress — именно они
 * отрисованы в переключателе (украинский показывает UA, а не UK).
 */
function rentos_a11y_switcher_label( $translated, $text, $domain ) {
	if ( 'translatepress-multilingual' !== $domain || 'Change language' !== $text || is_admin() ) {
		return $translated;
	}

	global $TRP_LANGUAGE;

	$settings = get_option( 'trp_settings' );
	$slug     = $settings['url-slugs'][ $TRP_LANGUAGE ] ?? '';

	if ( ! $slug ) {
		return $translated;
	}

	return strtoupper( $slug ) . ' — ' . $translated;
}
add_filter( 'gettext_translatepress-multilingual', 'rentos_a11y_switcher_label', 10, 3 );

/**
 * Поиск BetterDocs на странице документации приходил наполовину по-английски: у кнопки
 * подпись «Search», у неё же `aria-label` «Search Submit» — и это на русской версии сайта,
 * то есть на языке оригинала, откуда TranslatePress переводит дальше. Пока строка английская,
 * перевести её на остальные языки нечем. Подставляем русские подписи — их уже подхватит словарь.
 */
function rentos_a11y_betterdocs_search( $translated, $text, $domain ) {
	if ( 'betterdocs' !== $domain || is_admin() ) {
		return $translated;
	}

	// Подменяем только то, что осталось без перевода: где перевод из .mo есть, он главнее.
	if ( $translated !== $text ) {
		return $translated;
	}

	$map = [
		'Search'        => 'Найти',
		'Search Submit' => 'Отправить поиск',
	];

	return $map[ $text ] ?? $translated;
}
add_filter( 'gettext_betterdocs', 'rentos_a11y_betterdocs_search', 10, 3 );
