<?php
/**
 * Plugin Name: RentOS — счётчик, растущий сам
 * Description: Шорткод [rentos_counter] для динамического тега Elementor: число, которое само прибавляется на шаг раз в неделю или раз в месяц.
 * Version: 1.1
 *
 * Зачем: в CTA главной стоит штатный виджет «Счётчик» Elementor, у которого
 * поле «Конечное число» привязано штатным динамическим тегом «Шорткод» к этому
 * шорткоду. Всё, что настраивается, живёт в атрибутах прямо в панели Elementor —
 * файл трогать не нужно:
 *
 *   [rentos_counter start=36 since=2026-08-22 period=week step=1]
 *
 *   start  — сколько было на дату since (по умолчанию 36)
 *   since  — базовая дата: ГГГГ-ММ-ДД для недель, ГГГГ-ММ для месяцев
 *   period — week (по умолчанию) или month
 *   step   — на сколько прибавлять каждый период (по умолчанию 1)
 *   max    — потолок, 0 = без потолка
 *
 * То есть при period=week число растёт на 1 каждые 7 дней от даты since.
 *
 * Важно про кэш: значение попадает в разметку при её генерации, поэтому смена
 * недели видна на сайте после того, как обновится кэш страницы (WP Rocket +
 * кэш отрисовки Elementor).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_shortcode(
	'rentos_counter',
	function ( $atts ) {
		$atts = shortcode_atts(
			array(
				'start'  => 36,
				'since'  => '2026-08-22',
				'period' => 'week',
				'step'   => 1,
				'max'    => 0,
			),
			$atts,
			'rentos_counter'
		);

		$start  = (int) $atts['start'];
		$step   = (int) $atts['step'];
		$max    = (int) $atts['max'];
		$period = strtolower( trim( (string) $atts['period'] ) );
		$since  = trim( (string) $atts['since'] );

		// Кривая дата — отдаём стартовое число, а не ноль: на странице лучше
		// честное «36», чем пустой счётчик.
		if ( preg_match( '/^(\d{4})-(\d{1,2})-(\d{1,2})$/', $since, $m ) ) {
			$since_ymd = sprintf( '%04d-%02d-%02d', $m[1], $m[2], $m[3] );
		} elseif ( preg_match( '/^(\d{4})-(\d{1,2})$/', $since, $m ) ) {
			$since_ymd = sprintf( '%04d-%02d-01', $m[1], $m[2] );
		} else {
			return (string) $start;
		}

		// current_time() с форматом отдаёт дату в часовом поясе сайта —
		// именно она решает, наступил ли новый период.
		$today_ymd = current_time( 'Y-m-d' );

		if ( 'month' === $period ) {
			$since_months = (int) substr( $since_ymd, 0, 4 ) * 12 + (int) substr( $since_ymd, 5, 2 );
			$today_months = (int) substr( $today_ymd, 0, 4 ) * 12 + (int) substr( $today_ymd, 5, 2 );
			$elapsed      = $today_months - $since_months;
		} else {
			$days    = ( strtotime( $today_ymd . ' 00:00:00' ) - strtotime( $since_ymd . ' 00:00:00' ) ) / DAY_IN_SECONDS;
			$elapsed = (int) floor( $days / 7 );
		}

		$value = $start + max( 0, $elapsed ) * $step;

		if ( $max > 0 ) {
			$value = min( $value, $max );
		}

		return (string) max( 0, $value );
	}
);
