<?php
/**
 * Plugin Name: RentOS — WP Rocket не выбирает LCP из листаемых кадров карусели
 * Description: WP Rocket сам находит главную картинку страницы (LCP) скриптом-маяком у посетителя
 *              и запоминает её в wp_wpr_above_the_fold: ставит ей fetchpriority="high" и
 *              предзагрузку в <head>. На «Возможностях» маяк срабатывал, когда карусель первого
 *              экрана уже перелистнулась, и записал slide3 — а на экране при загрузке slide1.
 *              PageSpeed 14.10.2026: LCP — slide1 без fetchpriority, а в <head> предзагрузка
 *              ненужного slide3. Записи исправлены вручную на slide1; этот фильтр не даёт
 *              следующему замеру снова выбрать второй или третий кадр.
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'rocket_atf_valid_image', function ( $valid, $src ) {
	if ( preg_match( '#/wp-content/uploads/2026/08/slide[23]\.jpg(\.webp)?$#', (string) $src ) ) {
		return false;
	}
	return $valid;
}, 10, 2 );
