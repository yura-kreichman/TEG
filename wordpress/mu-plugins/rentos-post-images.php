<?php
/**
 * Plugin Name: RentOS — картинки в статьях блога: srcset и приоритет обложки
 * Description: Статьи блога заводились скриптом, и блоки картинок в них без ID вложения:
 *              <!-- wp:image {"sizeSlug":"large"} --> и <img src="…"> без класса wp-image-N.
 *              По этому классу ядро (wp_filter_content_tags) находит вложение и дописывает
 *              srcset, sizes, width и height — без него телефон получал оригинал 1200 px
 *              в контейнер 392 px (PageSpeed 14.10.2026: «экономия 114 КиБ» на одной картинке).
 *              Плюс первая картинка текста — это обложка статьи и она же LCP на телефоне,
 *              а WP Rocket делал её ленивой: адреса нет в исходном HTML, fetchpriority нет.
 *
 *              Содержимое записей в базе не трогаем: правка на лету переживёт и старые, и новые
 *              статьи, заведённые тем же способом, и не задевает словарь TranslatePress.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Раньше wp_filter_content_tags (приоритет 12): класс wp-image-N должен уже стоять.
add_filter( 'the_content', function ( $content ) {
	if ( is_admin() || ! is_singular( 'post' ) || get_the_ID() !== get_queried_object_id() ) {
		return $content;
	}
	if ( false === strpos( $content, '<img' ) ) {
		return $content;
	}

	return preg_replace_callback( '/<img\b[^>]*>/i', function ( $m ) {
		$tag = $m[0];

		if ( ! preg_match( '/\bwp-image-\d+\b/', $tag ) && preg_match( '/\ssrc="([^"]+)"/', $tag, $src ) ) {
			// Скриншоты приложения с суффиксом -ru TranslatePress подменяет на английские
			// по адресу файла; srcset рядом с ними увёл бы браузер на русский вариант.
			if ( ! preg_match( '/-ru(-\d+x\d+)?\.(jpe?g|png|webp)$/i', $src[1] ) ) {
				$rentos_attachment = attachment_url_to_postid( $src[1] );
				if ( $rentos_attachment ) {
					$tag = preg_match( '/\sclass="/', $tag )
						? preg_replace( '/\sclass="/', ' class="wp-image-' . $rentos_attachment . ' ', $tag, 1 )
						: preg_replace( '/^<img\b/i', '<img class="wp-image-' . $rentos_attachment . '"', $tag, 1 );
				}
			}
		}

		return $tag;
	}, $content );
}, 11 );

/*
 * Обложка (первая картинка текста статьи) — LCP на телефоне. Помечаем её ПОСЛЕ модуля
 * ImageLoadingOptimization Elementor: он висит на том же wp_content_img_tag с приоритетом 10,
 * иногда сам ставит fetchpriority и чужой атрибут не замечает — при равном приоритете
 * выходило два fetchpriority в одном теге. Поэтому здесь 20 и проверка «уже есть».
 */
add_filter( 'wp_content_img_tag', function ( $tag, $context ) {
	static $rentos_done = false;
	if ( $rentos_done || 'the_content' !== $context || is_admin() || ! is_singular( 'post' ) || get_the_ID() !== get_queried_object_id() ) {
		return $tag;
	}
	$rentos_done = true;

	$tag = preg_replace( '/\sloading="lazy"/i', '', $tag );
	if ( false === stripos( $tag, 'fetchpriority=' ) ) {
		$tag = preg_replace( '/^<img\b/i', '<img fetchpriority="high"', $tag, 1 );
	}
	// data-no-lazy — штатное исключение ленивой загрузки WP Rocket (RocketLazyload\Image).
	if ( false === stripos( $tag, 'data-no-lazy' ) ) {
		$tag = preg_replace( '/^<img\b/i', '<img data-no-lazy="1"', $tag, 1 );
	}
	return $tag;
}, 20, 2 );
