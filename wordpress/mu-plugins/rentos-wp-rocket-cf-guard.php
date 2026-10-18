<?php
/**
 * Plugin Name: RentOS — WP Rocket Cloudflare hook guard
 * Description: WP 7.1 перевёл ключи колбэков в $wp_filter на spl_object_id() — для замыканий это целое число. WP Rocket 3.23.1.1 в Cloudflare::unregister_callback() зовёт substr() по такому ключу под declare(strict_types=1) и роняет весь сайт фатальной ошибкой на init. Пока официальный плагин Cloudflare не установлен, этот колбэк бесполезен — снимаем его до срабатывания. Страховка на случай, если обновление WP Rocket затрёт патч в самом плагине.
 * Version: 1.0
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'init',
	static function () {
		// Официальный плагин Cloudflare установлен — не вмешиваемся, пусть WP Rocket работает штатно.
		if ( defined( 'CLOUDFLARE_PLUGIN_DIR' ) ) {
			return;
		}

		global $wp_filter;

		if ( empty( $wp_filter['init'] ) || ! $wp_filter['init'] instanceof WP_Hook ) {
			return;
		}

		foreach ( $wp_filter['init']->callbacks as $priority => $callbacks ) {
			foreach ( $callbacks as $key => $config ) {
				$fn = isset( $config['function'] ) ? $config['function'] : null;

				if ( ! is_array( $fn ) || ! isset( $fn[0], $fn[1] ) || ! is_object( $fn[0] ) ) {
					continue;
				}

				if ( 'unregister_cloudflare_clean_on_post' !== $fn[1] ) {
					continue;
				}

				if ( 0 !== strncmp( get_class( $fn[0] ), "WP_Rocket", 9 ) ) {
					continue;
				}

				unset( $wp_filter['init']->callbacks[ $priority ][ $key ] );
			}
		}
	},
	- PHP_INT_MAX
);
