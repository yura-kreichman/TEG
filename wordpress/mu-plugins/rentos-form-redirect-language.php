<?php
/**
 * Plugin Name: RentOS — язык страницы после отправки формы
 * Description: Fluent Forms строит адрес страницы-подтверждения через get_permalink() внутри
 *              admin-ajax.php. Языка в этом запросе нет, поэтому клиент с /en/ уезжал на русскую
 *              версию страницы «Спасибо». Берём язык из скрытого поля TranslatePress, которое тот
 *              подмешивает в каждую форму, и переводим адрес его же конвертером.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Слаг языка из запроса. Fluent Forms шлёт форму одной строкой в поле `data`,
 * поэтому верхнего уровня $_POST недостаточно — разбираем строку.
 */
function rentos_frl_request_slug() {
	if ( ! empty( $_POST['trp-form-language'] ) ) {
		return sanitize_key( wp_unslash( $_POST['trp-form-language'] ) );
	}

	if ( ! empty( $_POST['data'] ) && is_string( $_POST['data'] ) ) {
		parse_str( wp_unslash( $_POST['data'] ), $fields );
		if ( ! empty( $fields['trp-form-language'] ) ) {
			return sanitize_key( $fields['trp-form-language'] );
		}
	}

	// Запасной путь: первый сегмент адреса страницы, с которой пришла отправка.
	$referer = wp_get_referer();
	if ( $referer ) {
		$path = trim( (string) wp_parse_url( $referer, PHP_URL_PATH ), '/' );
		$first = strtok( $path, '/' );
		if ( $first ) {
			return sanitize_key( $first );
		}
	}

	return '';
}

/**
 * Слаг → локаль по настройкам TranslatePress (украинский слаг `ua`, локаль `uk` — не совпадают).
 */
function rentos_frl_locale_for_slug( $slug ) {
	$settings = get_option( 'trp_settings' );
	$slugs    = is_array( $settings ) && ! empty( $settings['url-slugs'] ) ? $settings['url-slugs'] : [];
	$locale   = array_search( $slug, $slugs, true );

	if ( ! $locale || $locale === ( $settings['default-language'] ?? '' ) ) {
		return '';
	}

	$published = $settings['publish-languages'] ?? [];
	return in_array( $locale, (array) $published, true ) ? $locale : '';
}

function rentos_frl_translate_redirect( $url ) {
	if ( ! is_string( $url ) || '' === $url || ! class_exists( 'TRP_Translate_Press' ) ) {
		return $url;
	}

	$locale = rentos_frl_locale_for_slug( rentos_frl_request_slug() );
	if ( ! $locale ) {
		return $url;
	}

	$converter = TRP_Translate_Press::get_trp_instance()->get_component( 'url_converter' );
	if ( ! $converter || ! method_exists( $converter, 'get_url_for_language' ) ) {
		return $url;
	}

	// Конвертер знает и про переведённые слаги, руками префикс не клеим.
	$translated = $converter->get_url_for_language( $locale, $url, '' );

	return $translated ? $translated : $url;
}
add_filter( 'fluentform/redirect_url_value', 'rentos_frl_translate_redirect', 20 );
