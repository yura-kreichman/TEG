<?php
/**
 * Plugin Name: RentOS — доступность сервиса
 * Description: Шорткод [rentos_uptime] для подвала: измеренная доступность my.rentos365.app и число дней без сбоев.
 * Version: 1.0
 *
 * Откуда данные: скрипт rentos-uptime/check.sh раз в минуту дёргает
 * https://my.rentos365.app/api/health (там не «процесс жив», а реальный
 * SELECT 1 к Postgres) и дописывает строку «время,код» в samples.csv.
 * Файл лежит вне корня сайта.
 *
 * Раз в час этот плагин пересчитывает окно и кладёт готовые числа в опцию.
 * Шорткод только печатает их — на запрос посетителя ничего не считается.
 *
 * Как считаем:
 *  - минута «плохая», если замер не 2xx ИЛИ замера за эту минуту нет вовсе
 *    (нет замера = машина не работала, cron тоже не работал);
 *  - одиночная плохая минута НЕ считается сбоем — это подтверждение вторым
 *    замером, как делают все мониторинги, и заодно наши деплои с их
 *    30–60 секундами 502 не портят статистику (решение владельца 2026-08-22);
 *  - сбоем считается серия из двух и более плохих минут подряд;
 *  - процент округляем ВНИЗ до одного знака: лучше показать меньше, чем
 *    приписать себе лишнего.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const RENTOS_UPTIME_FILE      = '/var/www/md33/data/rentos-uptime/samples.csv';
const RENTOS_UPTIME_OPTION    = 'rentos_uptime_stats';
const RENTOS_UPTIME_WINDOW    = 30;      // дней в окне
const RENTOS_UPTIME_KEEP_DAYS = 45;      // сколько храним замеров
const RENTOS_UPTIME_MIN_HOURS = 24;      // до этого строку не показываем вовсе
const RENTOS_UPTIME_FOOTER_ID = 118;     // шаблон подвала Elementor

/* -------------------------------------------------------------------------
 * Пересчёт раз в час
 * ---------------------------------------------------------------------- */

add_action(
	'init',
	function () {
		if ( ! wp_next_scheduled( 'rentos_uptime_refresh' ) ) {
			wp_schedule_event( time() + 300, 'hourly', 'rentos_uptime_refresh' );
		}
	}
);

add_action( 'rentos_uptime_refresh', 'rentos_uptime_recalculate' );

function rentos_uptime_recalculate() {
	$stats = rentos_uptime_build_stats();

	if ( null === $stats ) {
		return;
	}

	$previous = get_option( RENTOS_UPTIME_OPTION );

	update_option( RENTOS_UPTIME_OPTION, $stats, false );

	// Строка в подвале меняется редко (процент — до десятых, дни — раз в
	// сутки), поэтому чистим кэш только когда меняется то, что видно.
	$sameText = is_array( $previous )
		&& isset( $previous['percent'], $previous['days_ok'], $previous['window_days'] )
		&& $previous['percent'] === $stats['percent']
		&& (int) $previous['days_ok'] === (int) $stats['days_ok']
		&& (int) $previous['window_days'] === (int) $stats['window_days'];

	if ( $sameText ) {
		return;
	}

	// Подвал сидит в отрисованном кэше шаблона и в кэше каждой страницы.
	delete_post_meta( RENTOS_UPTIME_FOOTER_ID, '_elementor_element_cache' );
	delete_post_meta( RENTOS_UPTIME_FOOTER_ID, '_elementor_element_cache_unique_id' );

	if ( function_exists( 'rocket_clean_domain' ) ) {
		rocket_clean_domain();
	}

	rentos_uptime_warm_cache();
}

/**
 * После полной уборки прогреваем главные адреса, чтобы первый живой посетитель
 * не ждал генерацию. Неблокирующе — задание не должно из-за этого висеть.
 */
function rentos_uptime_warm_cache() {
	$home = untrailingslashit( get_option( 'home' ) );

	foreach ( array( '/', '/features/', '/prices/', '/en/', '/ua/', '/it/', '/ro/' ) as $path ) {
		wp_remote_get(
			$home . $path,
			array(
				'timeout'  => 0.01,
				'blocking' => false,
				'headers'  => array( 'Accept' => 'text/html,image/webp,*/*' ),
			)
		);
	}
}

/**
 * @return array{percent: string, days_ok: int, window_days: int, samples: int, updated: int}|null
 */
function rentos_uptime_build_stats() {
	if ( ! is_readable( RENTOS_UPTIME_FILE ) ) {
		return null;
	}

	$now       = time();
	$nowMinute = (int) floor( $now / 60 );
	$keepFrom  = $now - RENTOS_UPTIME_KEEP_DAYS * DAY_IN_SECONDS;

	$byMinute   = array();
	$firstStamp = null;
	$keepLines  = array();

	$fh = fopen( RENTOS_UPTIME_FILE, 'r' );
	if ( ! $fh ) {
		return null;
	}

	while ( false !== ( $line = fgets( $fh ) ) ) {
		$line = trim( $line );
		if ( '' === $line ) {
			continue;
		}

		list( $stamp, $code ) = array_pad( explode( ',', $line, 2 ), 2, '0' );

		$stamp = (int) $stamp;
		$code  = (int) $code;

		if ( $stamp <= 0 || $stamp < $keepFrom ) {
			continue; // слишком старое — в новый файл не переносим
		}

		$keepLines[] = $stamp . ',' . $code;

		if ( null === $firstStamp || $stamp < $firstStamp ) {
			$firstStamp = $stamp;
		}

		$minute = (int) floor( $stamp / 60 );

		// В минуте может оказаться два замера: плохой перевешивает.
		$ok = ( $code >= 200 && $code < 300 );
		if ( ! isset( $byMinute[ $minute ] ) || ! $ok ) {
			$byMinute[ $minute ] = $ok;
		}
	}

	fclose( $fh );

	if ( null === $firstStamp ) {
		return null;
	}

	// Прореживаем файл, чтобы он не рос вечно.
	if ( count( $keepLines ) > 0 ) {
		$tmp = RENTOS_UPTIME_FILE . '.tmp';
		if ( false !== file_put_contents( $tmp, implode( "\n", $keepLines ) . "\n", LOCK_EX ) ) {
			@rename( $tmp, RENTOS_UPTIME_FILE );
		}
	}

	$windowStartMinute = max(
		(int) floor( $firstStamp / 60 ),
		$nowMinute - RENTOS_UPTIME_WINDOW * 24 * 60
	);

	// Последнюю минуту не берём: замер за неё может ещё не успеть записаться.
	$lastMinute   = $nowMinute - 1;
	$totalMinutes = $lastMinute - $windowStartMinute + 1;

	if ( $totalMinutes < RENTOS_UPTIME_MIN_HOURS * 60 ) {
		return null; // данных пока мало, строку не показываем
	}

	$downMinutes    = 0;
	$runLength      = 0;
	$lastIncidentAt = null;

	for ( $minute = $windowStartMinute; $minute <= $lastMinute; $minute++ ) {
		$ok = isset( $byMinute[ $minute ] ) ? $byMinute[ $minute ] : false;

		if ( $ok ) {
			if ( $runLength >= 2 ) {
				$downMinutes   += $runLength;
				$lastIncidentAt = ( $minute - 1 ) * 60;
			}
			$runLength = 0;
			continue;
		}

		$runLength++;
	}

	// Незакрытая серия на конце окна.
	if ( $runLength >= 2 ) {
		$downMinutes   += $runLength;
		$lastIncidentAt = $lastMinute * 60;
	}

	$ratio   = ( $totalMinutes - $downMinutes ) / $totalMinutes;
	$percent = floor( $ratio * 1000 ) / 10; // вниз, до десятых

	$since   = null === $lastIncidentAt ? $firstStamp : $lastIncidentAt;
	$daysOk  = (int) floor( ( $now - $since ) / DAY_IN_SECONDS );
	$window  = (int) floor( $totalMinutes / ( 24 * 60 ) );

	return array(
		'percent'      => number_format( $percent, 1, '.', '' ),
		'days_ok'      => $daysOk,
		'window_days'  => max( 1, $window ),
		'down_minutes' => $downMinutes,
		'samples'      => count( $keepLines ),
		'updated'      => $now,
	);
}

/**
 * Последний замер — успешный? Читаем хвост файла, а не весь файл: это
 * дёргается на рендере страницы, пока не накопилась статистика.
 */
function rentos_uptime_last_sample_ok() {
	if ( ! is_readable( RENTOS_UPTIME_FILE ) ) {
		return false;
	}

	$size = filesize( RENTOS_UPTIME_FILE );
	if ( ! $size ) {
		return false;
	}

	$fh = fopen( RENTOS_UPTIME_FILE, 'r' );
	if ( ! $fh ) {
		return false;
	}

	fseek( $fh, max( 0, $size - 200 ) );
	$tail = fread( $fh, 200 );
	fclose( $fh );

	$lines = array_values( array_filter( array_map( 'trim', explode( "\n", (string) $tail ) ) ) );
	if ( ! $lines ) {
		return false;
	}

	list( $stamp, $code ) = array_pad( explode( ',', end( $lines ), 2 ), 2, '0' );

	// Замер старше пяти минут — значит сборщик встал, молчим.
	if ( time() - (int) $stamp > 5 * MINUTE_IN_SECONDS ) {
		return false;
	}

	return (int) $code >= 200 && (int) $code < 300;
}

/* -------------------------------------------------------------------------
 * Вывод
 * ---------------------------------------------------------------------- */

add_shortcode(
	'rentos_uptime',
	function () {
		$stats  = get_option( RENTOS_UPTIME_OPTION );
		$locale = determine_locale();
		$lang   = substr( (string) determine_locale(), 0, 2 );

		// Первые сутки статистики ещё нет. Показываем только то, что реально
		// знаем: последний замер минуту назад прошёл. Если и он неудачный —
		// не пишем ничего, врать про «работает» во время аварии нельзя.
		if ( ! is_array( $stats ) || ! isset( $stats['percent'] ) ) {
			if ( ! rentos_uptime_last_sample_ok() ) {
				return '';
			}

			$short = array(
				'ru' => 'Сервис работает',
				'en' => 'Service is up',
				'uk' => 'Сервіс працює',
				'it' => 'Servizio attivo',
				'ro' => 'Serviciul funcționează',
			);

			$text = isset( $short[ $lang ] ) ? $short[ $lang ] : $short['en'];

			return '<span data-no-translation><span style="color:#22C55E">&#9679;</span> ' . esc_html( $text ) . '</span>';
		}

		// Строка собирается здесь и помечается data-no-translation: числа в ней
		// меняются, и словарь TranslatePress на них разъезжался бы. Языки
		// прописаны прямо тут — тот же приём, что в rentos-fluentauth-i18n.php.
		$templates = array(
			'ru' => 'Сервис работает · доступность %1$s%% за %2$d дн. · без сбоев %3$d дн.',
			'en' => 'Service is up · %1$s%% uptime over %2$d days · %3$d days without incidents',
			'uk' => 'Сервіс працює · доступність %1$s%% за %2$d дн. · без збоїв %3$d дн.',
			'it' => 'Servizio attivo · disponibilità %1$s%% su %2$d giorni · %3$d giorni senza guasti',
			'ro' => 'Serviciul funcționează · disponibilitate %1$s%% în %2$d zile · %3$d zile fără incidente',
		);

		// Сбой был меньше суток назад — про «без сбоев 0 дн.» не пишем,
		// оставляем только процент (он этот сбой уже честно учёл).
		if ( (int) $stats['days_ok'] < 1 ) {
			$templates = array(
				'ru' => 'Сервис работает · доступность %1$s%% за %2$d дн.',
				'en' => 'Service is up · %1$s%% uptime over %2$d days',
				'uk' => 'Сервіс працює · доступність %1$s%% за %2$d дн.',
				'it' => 'Servizio attivo · disponibilità %1$s%% su %2$d giorni',
				'ro' => 'Serviciul funcționează · disponibilitate %1$s%% în %2$d zile',
			);
		}

		$template = isset( $templates[ $lang ] ) ? $templates[ $lang ] : $templates['en'];

		// Десятичный разделитель по языку.
		$percent = in_array( $lang, array( 'ru', 'uk', 'it', 'ro' ), true )
			? str_replace( '.', ',', $stats['percent'] )
			: $stats['percent'];

		$text = sprintf(
			$template,
			$percent,
			(int) $stats['window_days'],
			(int) $stats['days_ok']
		);

		return '<span data-no-translation><span style="color:#22C55E">&#9679;</span> ' . esc_html( $text ) . '</span>';
	}
);
