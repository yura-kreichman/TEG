<?php
/**
 * Plugin Name: RentOS — карусель галереи не замирает от касания
 * Description: Slick по умолчанию ставит автопрокрутку на паузу, когда слайд получает фокус
 *              (а касание пальцем его и даёт) и когда курсор над точками. У виджета Ultimate
 *              Addons в панели есть только «пауза при наведении», остальные ключи он не отдаёт.
 *              Дописываем их через его же фильтр — своего JS не заводим.
 * Author: RentOS
 * Version: 1.0
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
