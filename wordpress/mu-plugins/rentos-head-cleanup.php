<?php
/**
 * Plugin Name: RentOS — уборка служебных тегов в <head>
 * Description: Убирает следы движка из разметки: версию WordPress, RSD/xmlrpc, короткую ссылку,
 *              ссылки oEmbed и REST API. Заодно снимает эмодзи-скрипт и wp-embed — на сайте
 *              нет ни эмодзи-графики, ни встроенных записей других блогов, а это лишние запросы.
 *              Ассеты в /wp-content/ не трогаем: их адреса переписать нечем, да и смысла нет.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function rentos_hc_strip_head() {
	// Версия WordPress в <meta generator> — единственный по-настоящему лишний намёк:
	// по ней подбирают эксплойты под конкретный релиз.
	remove_action( 'wp_head', 'wp_generator' );

	// Really Simple Discovery ведёт на xmlrpc.php, которым сайт не пользуется.
	remove_action( 'wp_head', 'rsd_link' );
	remove_action( 'wp_head', 'wlwmanifest_link' );

	// Короткая ссылка вида /?p=123 — адрес «как в WordPress», ровно то, что просили убрать.
	remove_action( 'wp_head', 'wp_shortlink_wp_head' );
	remove_action( 'template_redirect', 'wp_shortlink_header', 11 );

	// Обнаружение oEmbed и REST: сайт никто не встраивает, а ссылки светят /wp-json/.
	remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );
	remove_action( 'wp_head', 'rest_output_link_wp_head', 10 );
	remove_action( 'template_redirect', 'rest_output_link_header', 11 );

	// Эмодзи: детектор в <head> плюс отдельный CSS. Ни того, ни другого сайту не нужно.
	remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
	remove_action( 'wp_print_styles', 'print_emoji_styles' );
	remove_action( 'wp_head', 'wp_enqueue_emoji_styles' );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
}
add_action( 'init', 'rentos_hc_strip_head' );

/**
 * Скрипт встраивания чужих записей. Своих oEmbed-вставок на сайте нет —
 * видео идут штатным виджетом Elementor, он этот файл не использует.
 */
function rentos_hc_dequeue_embed() {
	if ( is_admin() ) {
		return;
	}

	wp_dequeue_script( 'wp-embed' );
}
add_action( 'wp_footer', 'rentos_hc_dequeue_embed', 1 );

/**
 * Заголовок X-Pingback: тот же xmlrpc, только в шапке ответа.
 */
function rentos_hc_headers( $headers ) {
	unset( $headers['X-Pingback'] );

	return $headers;
}
add_filter( 'wp_headers', 'rentos_hc_headers' );

/**
 * Site Kit печатает свою версию собственным тегом. У плагина для этого есть штатный фильтр.
 */
add_filter( 'googlesitekit_generator', '__return_empty_string' );

/**
 * Тег Elementor выключается его же настройкой `elementor_meta_generator_tag`,
 * см. modules/generator-tag/module.php. Значение ставится один раз при загрузке плагина,
 * фильтром опции — чтобы не зависеть от того, что кто-то переключит галочку в панели.
 */
add_filter( 'option_elementor_meta_generator_tag', function () {
	return '1';
} );
