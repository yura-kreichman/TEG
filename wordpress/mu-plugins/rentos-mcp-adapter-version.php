<?php
/**
 * Plugin Name: RentOS — версия MCP Adapter для Fluent
 * Description: Объявляет WP_MCP_VERSION, когда классы MCP Adapter уже загружены встроенной копией EMCP. Без этого FluentCart и Fluent Support пишут «адаптер MCP не найден», хотя их MCP-серверы работают.
 * Version: 1.0
 *
 * Почему так (2026-10-10):
 *  - EMCP Pro при загрузке забирает себе всё пространство имён WP\MCP\
 *    (своя копия адаптера 0.6.1, см. emcp-pro/includes/class-mcp-adapter-bootstrap.php),
 *    но грузит только классы, а не mcp-adapter.php, где объявлена константа.
 *  - FluentCart, Fluent Support, Fluent Forms и Fluent Toolkit проверяют
 *    адаптер именно по defined('WP_MCP_VERSION'). Toolkit свою копию тоже
 *    не грузит: видит, что WP\MCP\Plugin уже есть.
 *  - Отдельный плагин mcp-adapter 0.7.0 при этом не мог загрузиться вовсе
 *    и только показывал красное «Another version of MCP Adapter…», поэтому
 *    он деактивирован.
 *
 * Константу ставим значением реально загруженного класса, так что версия
 * в настройках Fluent совпадает с тем, что работает.
 *
 * Закрепление копии EMCP. WP Rocket при загрузке своего файла
 * (inc/main.php) зовёт class_exists(McpAdapter) через собственный composer-
 * автозагрузчик, поставленный в начало очереди, и подтягивает свою копию
 * 0.5.0. Остальные классы потом берутся из EMCP 0.6.1, получается смесь
 * версий, от которой EMCP прямо предупреждает. Раньше это прикрывал
 * отдельный плагин mcp-adapter: он грузился между EMCP и WP Rocket и
 * случайно загружал McpAdapter из EMCP. Теперь делаем это нарочно: сразу
 * после файла EMCP, пока его загрузчик первый.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'plugin_loaded',
	static function ( $file ) {
		if ( 'emcp-pro/emcp-tools.php' === plugin_basename( $file ) ) {
			class_exists( '\WP\MCP\Core\McpAdapter' );
		}
	}
);

add_action(
	'plugins_loaded',
	static function () {
		if ( defined( 'WP_MCP_VERSION' ) || ! class_exists( '\WP\MCP\Core\McpAdapter', false ) ) {
			return;
		}
		define( 'WP_MCP_VERSION', \WP\MCP\Core\McpAdapter::VERSION );
	},
	1
);
