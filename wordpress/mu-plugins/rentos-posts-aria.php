<?php
/**
 * Plugin Name: RentOS — карточки записей без недопустимой роли listitem
 * Description: Виджет «Записи» Elementor Pro (skin-base.php, skin-cards.php) печатает
 *              <article role="listitem"> внутри <div class="elementor-posts-container" role="list">.
 *              Тегу article роль listitem не положена (axe: aria-allowed-role), и PageSpeed
 *              14.10.2026 ронял на этом «Агентный просмотр» (проверка «Дерево доступности имеет
 *              неверный формат») — единственная непройденная в категории. Снимаем пару целиком:
 *              без listitem у карточек роль list у контейнера дала бы «список без элементов».
 *              Карточки остаются <article> — это и так самостоятельные записи.
 *
 *              После правки чистить _elementor_element_cache: разметка виджетов кэшируется.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'elementor/widget/render_content', function ( $content, $widget ) {
	if ( ! in_array( $widget->get_name(), [ 'posts', 'archive-posts', 'portfolio' ], true ) ) {
		return $content;
	}

	$content = preg_replace( '/(<article\b[^>]*?)\s+role="listitem"/i', '$1', $content );
	$content = preg_replace( '/(<div\b[^>]*\belementor-posts-container\b[^>]*?)\s+role="list"/i', '$1', $content );

	return $content;
}, 10, 2 );
