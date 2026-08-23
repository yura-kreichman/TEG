<?php
/**
 * Plugin Name: RentOS — защита CSS Elementor от сброса на каждом запросе
 * Description: Elementor 4.2.3 добавил слушатели update_option/delete_option
 *              для _elementor_pro_license_v2_data, которые зовут
 *              files_manager->clear_cache() — то есть сносят _elementor_css и
 *              uploads/elementor/css целиком. Сборка Elementor Pro на этом сайте
 *              пишет эту опцию на КАЖДОМ запросе (timeout = now + 12h пересчитывается
 *              каждый раз), поэтому весь CSS сайта пересобирался при каждом обращении:
 *              TTFB 5-10 с и 404 на post-*.css в браузере («падают стили»).
 *              Снимаем оба слушателя. Штатная инвалидация при реальных правках
 *              остаётся: elementor/document/after_save, elementor/core/files/clear_cache,
 *              deleted_post — их не трогаем.
 *              Найдено 2026-08-20 по стеку вызовов.
 * Version:     1.0
 */

defined( 'ABSPATH' ) || exit;

// Elementor регистрирует эти слушатели на init:0 (modules/atomic-widgets/module.php),
// подделка лицензии пишет опцию на init:10 — снимаем между ними.
add_action(
	'init',
	static function () {
		remove_all_actions( 'update_option__elementor_pro_license_v2_data' );
		remove_all_actions( 'delete_option__elementor_pro_license_v2_data' );
	},
	9
);
