<?php
/**
 * Plugin Name: RentOS — карусель галереи: не замирает от касания, верный sizes у картинок
 * Description: Slick по умолчанию ставит автопрокрутку на паузу, когда слайд получает фокус
 *              (а касание пальцем его и даёт) и когда курсор над точками. У виджета Ultimate
 *              Addons в панели есть только «пауза при наведении», остальные ключи он не отдаёт.
 *              Дописываем их через его же фильтр — своего JS не заводим.
 * Author: RentOS
 * Version: 1.1
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'uael_image_gallery_carousel_options', function ( $options ) {
	$options['pauseOnHover']     = false;
	$options['pauseOnFocus']     = false;
	$options['pauseOnDotsHover'] = false;

	// Листаем всегда парами. `swipeToSlide` этому мешает: при нём палец переносит ленту
	// на тот слайд, где остановился, то есть по одному. Выключаем — свайп двигает ленту
	// ровно на `slidesToScroll`.
	$options['swipeToSlide']  = false;
	$options['slidesToScroll'] = 2;

	// У планшетного брейкпоинта виджет берёт значение из умолчаний контрола (1), а не из
	// настроек страницы — правим прямо в наборе адаптивных правил.
	if ( ! empty( $options['responsive'] ) && is_array( $options['responsive'] ) ) {
		foreach ( $options['responsive'] as $i => $rule ) {
			$options['responsive'][ $i ]['settings']['slidesToScroll'] = 2;
		}
	}

	return $options;
} );

/*
 * Правильный `sizes` у картинок карусели.
 *
 * Ядро печатает `sizes` по размеру «medium»: «(max-width: 300px) 100vw, 300px». Слот же
 * в карусели — 180 px на телефоне (412) и 281 px на ПК (1920). Телефон с плотностью
 * 1,75 считает 300 × 1,75 = 525 и берёт оригинал 600 px (до 82 КБ на картинку,
 * 17 картинок) — PageSpeed записал это в «экономию 817 КиБ». С верным `sizes` браузер
 * сам берёт копию 360 или 300 px из того же `srcset`.
 *
 * Включать «на время отрисовки виджета» нельзя: виджет печатает `<img>` без `srcset`
 * и `sizes`, их потом дописывает ядро фильтром контента (`wp_filter_content_tags`),
 * когда виджет уже отрисован. Поэтому картинки галереи узнаём по ID вложений из
 * настройки `wp_gallery` самих виджетов текущей страницы.
 */
function rentos_gallery_image_ids() {
	static $ids = null;
	if ( null !== $ids ) {
		return $ids;
	}

	$ids     = [];
	$post_id = is_singular() ? get_queried_object_id() : 0;
	$raw     = $post_id ? get_post_meta( $post_id, '_elementor_data', true ) : '';
	if ( ! $raw || false === strpos( $raw, 'uael-image-gallery' ) ) {
		return $ids;
	}

	$walk = function ( $elements ) use ( &$walk, &$ids ) {
		foreach ( (array) $elements as $element ) {
			if ( 'uael-image-gallery' === ( $element['widgetType'] ?? '' ) ) {
				foreach ( (array) ( $element['settings']['wp_gallery'] ?? [] ) as $image ) {
					if ( ! empty( $image['id'] ) ) {
						$ids[ (int) $image['id'] ] = true;
					}
				}
			}
			if ( ! empty( $element['elements'] ) ) {
				$walk( $element['elements'] );
			}
		}
	};
	$walk( json_decode( $raw, true ) );

	return $ids;
}

add_filter( 'wp_calculate_image_sizes', function ( $sizes, $size, $image_src, $image_meta, $attachment_id ) {
	if ( is_admin() || ! $attachment_id || empty( rentos_gallery_image_ids()[ (int) $attachment_id ] ) ) {
		return $sizes;
	}
	return '(max-width: 767px) 44vw, (max-width: 1024px) 30vw, 281px';
}, 20, 5 );
