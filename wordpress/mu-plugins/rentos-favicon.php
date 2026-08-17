<?php
/**
 * Plugin Name: RentOS — фавиконка для Яндекса
 * Description: Ссылка на /favicon.ico в корне и вариант 120×120, у всех тегов иконок — атрибут type.
 *
 * Зачем. Яндекс.Вебмастер сообщал «Файл favicon не найден»: физического файла в
 * корне не было, и /favicon.ico отдавал 302 на картинку в uploads. По требованиям
 * Яндекса фавиконка должна лежать в корне и отдаваться 200 OK по прямой ссылке —
 * перенаправление названо отдельной причиной отказа, как и отсутствие type у
 * <link rel="icon">. Google за редиректом ходил спокойно, поэтому в Search Console
 * это не всплывало.
 *
 * Сами файлы (favicon.ico на 16/32/48 и favicon-120x120.png) лежат в корне сайта
 * и отдаются nginx'ом, минуя WordPress. 120×120 — размер, в котором Яндекс рисует
 * иконку в выдаче; самый крупный из прежних тегов был 32×32.
 *
 * Порядок тегов: наши идут ПЕРВЫМИ, поэтому браузеры по-прежнему выбирают
 * PNG с точным sizes — вид вкладки не меняется, добавляется только то, что ищет
 * робот.
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'site_icon_meta_tags',
	function ( $tags ) {
		// get_option('home'), а НЕ home_url(): TranslatePress подставляет в home_url()
		// языковой префикс текущей страницы, и на /ro/ вышло бы /ro/favicon.ico — 404.
		$root = untrailingslashit( (string) get_option( 'home' ) );

		if ( ! is_array( $tags ) ) {
			$tags = array();
		}

		// Яндекс при ошибке загрузки просит проверить значение type — у тегов ядра его нет.
		// Идём по содержимому тега, а не по именам ключей: в ядре они называются
		// site_icon_32 / site_icon_192 / site_icon_180, и любая правка ядра их переименует.
		$types = array(
			'png'  => 'image/png',
			'ico'  => 'image/x-icon',
			'svg'  => 'image/svg+xml',
			'jpg'  => 'image/jpeg',
			'jpeg' => 'image/jpeg',
			'gif'  => 'image/gif',
		);

		foreach ( $tags as $key => $tag ) {
			if ( ! is_string( $tag ) || false !== strpos( $tag, 'type=' ) ) {
				continue;
			}
			if ( false === strpos( $tag, 'rel="icon"' ) && false === strpos( $tag, 'rel="apple-touch-icon"' ) ) {
				continue;
			}
			if ( ! preg_match( '#href="[^"]+\.([a-z]{3,4})(?:\?|")#i', $tag, $m ) ) {
				continue;
			}
			$ext = strtolower( $m[1] );
			if ( isset( $types[ $ext ] ) ) {
				$tags[ $key ] = str_replace( ' />', ' type="' . $types[ $ext ] . '" />', $tag );
			}
		}

		$ours = array(
			'icon_ico' => sprintf(
				'<link rel="icon" href="%s" type="image/x-icon" />',
				esc_url( $root . '/favicon.ico' )
			),
			'icon_120' => sprintf(
				'<link rel="icon" href="%s" sizes="120x120" type="image/png" />',
				esc_url( $root . '/favicon-120x120.png' )
			),
		);

		return array_merge( $ours, $tags );
	}
);
