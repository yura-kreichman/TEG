<?php
/**
 * Plugin Name: RentOS — доступность сервиса
 * Description: Шорткод [rentos_uptime] для подвала: измеренная доступность my.rentos365.app и число дней без сбоев.
 * Version: 1.0
 *
 * Откуда данные: скрипт rentos-uptime/check.sh раз в 5 минут дёргает
 * https://my.rentos365.app/api/health (там не «процесс жив», а реальный
 * SELECT 1 к Postgres) и дописывает строку «время,код» в samples.csv.
 * Файл лежит вне корня сайта.
 *
 * Пересчёт окна — раз в СУТКИ (решение владельца 2026-08-22: не грузить
 * сервер). Задание при этом висит ежечасно и почти всегда выходит сразу: так
 * первые числа появляются через час после запуска монитора, а не через сутки.
 * Шорткод только печатает
 * готовые числа — на запрос посетителя файл не читается.
 *
 * Как считаем:
 *  - время бьётся на корзины по 5 минут (RENTOS_UPTIME_STEP), ровно по шагу
 *    замеров; корзина «плохая», если замер не 2xx ИЛИ замера за неё нет вовсе
 *    (нет замера = машина не работала, cron тоже не работал);
 *  - одиночная плохая корзина НЕ считается сбоем — это подтверждение вторым
 *    замером, как делают все мониторинги, и заодно наши деплои с их
 *    30–60 секундами 502 не портят статистику (решение владельца 2026-08-22);
 *  - сбоем считается серия из двух и более плохих корзин подряд, то есть
 *    недоступность дольше пяти минут;
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
const RENTOS_UPTIME_MIN_HOURS = 1;       // меньше часа замеров — считать нечего
const RENTOS_UPTIME_PCT_HOURS = 24;      // процент показываем, только набрав сутки
const RENTOS_UPTIME_FOOTER_ID = 118;     // шаблон подвала Elementor

/**
 * Последний известный перерыв ДО начала наблюдений. Отсчёт «без сбоев» ведётся
 * от него, пока монитор не зафиксирует настоящий сбой — тогда счётчик
 * сбрасывается на измеренную дату и дальше живёт только на замерах.
 *
 * 11 июля 2026 — день, когда поднялась прод-база (том Docker с Postgres создан
 * 2026-07-11 20:13); раньше этой даты сервиса в проде не существовало, первый
 * коммит репозитория — 7 июля 2026.
 */
const RENTOS_UPTIME_SEED = '2026-07-11';

/**
 * Шаг замеров в секундах — должен совпадать с расписанием check.sh в crontab.
 * Пересчёт бьёт время на корзины этого размера: корзина без замера считается
 * недоступностью, поэтому рассинхрон с cron'ом сразу испортит статистику.
 */
const RENTOS_UPTIME_STEP = 300; // 5 минут

/* -------------------------------------------------------------------------
 * Пересчёт раз в сутки (решение владельца 2026-08-22: не грузить сервер)
 * ---------------------------------------------------------------------- */

add_action(
	'init',
	function () {
		$event = function_exists( 'wp_get_scheduled_event' ) ? wp_get_scheduled_event( 'rentos_uptime_refresh' ) : false;

		if ( $event && 'hourly' !== $event->schedule ) {
			wp_clear_scheduled_hook( 'rentos_uptime_refresh' );
			$event = false;
		}

		if ( ! $event && ! wp_next_scheduled( 'rentos_uptime_refresh' ) ) {
			wp_schedule_event( time() + 120, 'hourly', 'rentos_uptime_refresh' );
		}
	}
);

add_action( 'rentos_uptime_refresh', 'rentos_uptime_maybe_recalculate' );

/**
 * Задание срабатывает раз в час, но РАБОТУ делает раз в сутки: разбор файла
 * замеров и возможная уборка кэша — тяжёлое, владелец просил не чаще суток.
 * Частый вызов нужен ровно для одного: чтобы первые числа появились через час
 * после запуска монитора, а не через сутки. Пустой проход стоит одного чтения
 * опции.
 */
function rentos_uptime_maybe_recalculate() {
	$stats = get_option( RENTOS_UPTIME_OPTION );

	if ( is_array( $stats ) && ! empty( $stats['updated'] ) ) {
		$age = time() - (int) $stats['updated'];

		// Медиана отклика требует хотя бы часа замеров. Пока её нет, разрешаем
		// пересчёт раз в час — иначе первая цифра появилась бы только через
		// сутки. Как появилась — снова раз в сутки.
		$limit = empty( $stats['response'] ) ? HOUR_IN_SECONDS - MINUTE_IN_SECONDS : DAY_IN_SECONDS - 5 * MINUTE_IN_SECONDS;

		if ( $age < $limit ) {
			return;
		}
	}

	rentos_uptime_recalculate();
}

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
		&& isset( $previous['percent'], $previous['streak_days'], $previous['window_days'], $previous['since'] )
		&& $previous['percent'] === $stats['percent']
		&& (int) $previous['window_days'] === (int) $stats['window_days']
		// Начало «полосы без сбоев» — от него шорткод считает дни при отрисовке.
		&& (int) $previous['since'] === (int) $stats['since']
		// И сами дни: они растут каждые сутки, даже когда всё остальное стоит.
		&& (int) $previous['streak_days'] === (int) $stats['streak_days']
		&& ( isset( $previous['response'] ) ? $previous['response'] : null ) === $stats['response'];

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

	$now         = time();
	$step        = RENTOS_UPTIME_STEP;
	$nowBucket   = (int) floor( $now / $step );
	$keepFrom    = $now - RENTOS_UPTIME_KEEP_DAYS * DAY_IN_SECONDS;
	$bucketsInDay = (int) floor( DAY_IN_SECONDS / $step );

	$byBucket   = array();
	$firstStamp = null;
	$keepLines  = array();
	$times      = array();

	$fh = fopen( RENTOS_UPTIME_FILE, 'r' );
	if ( ! $fh ) {
		return null;
	}

	while ( false !== ( $line = fgets( $fh ) ) ) {
		$line = trim( $line );
		if ( '' === $line ) {
			continue;
		}

		// Третье поле (время ответа) появилось 2026-08-22; у старых строк его нет.
		list( $stamp, $code, $secs ) = array_pad( explode( ',', $line, 3 ), 3, '' );

		$stamp = (int) $stamp;
		$code  = (int) $code;
		$secs  = ( '' === $secs ) ? null : (float) $secs;

		if ( $stamp <= 0 || $stamp < $keepFrom ) {
			continue; // слишком старое — в новый файл не переносим
		}

		$keepLines[] = null === $secs ? $stamp . ',' . $code : $stamp . ',' . $code . ',' . $secs;

		if ( null === $firstStamp || $stamp < $firstStamp ) {
			$firstStamp = $stamp;
		}

		$bucket = (int) floor( $stamp / $step );

		// В корзину может попасть несколько замеров: плохой перевешивает.
		$ok = ( $code >= 200 && $code < 300 );
		if ( ! isset( $byBucket[ $bucket ] ) || ! $ok ) {
			$byBucket[ $bucket ] = $ok;
		}

		// Время ответа берём только у удачных замеров: секунды таймаута
		// испортили бы медиану.
		if ( $ok && null !== $secs && $secs > 0 ) {
			$times[] = $secs;
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

	$windowStart = max(
		(int) floor( $firstStamp / $step ),
		$nowBucket - RENTOS_UPTIME_WINDOW * $bucketsInDay
	);

	// Последнюю корзину не берём: замер за неё может ещё не успеть записаться.
	$lastBucket   = $nowBucket - 1;
	$totalBuckets = $lastBucket - $windowStart + 1;

	if ( $totalBuckets * $step < RENTOS_UPTIME_MIN_HOURS * HOUR_IN_SECONDS ) {
		return null; // данных пока мало, строку не показываем
	}

	$downBuckets    = 0;
	$runLength      = 0;
	$lastIncidentAt = null;

	for ( $bucket = $windowStart; $bucket <= $lastBucket; $bucket++ ) {
		$ok = isset( $byBucket[ $bucket ] ) ? $byBucket[ $bucket ] : false;

		if ( $ok ) {
			if ( $runLength >= 2 ) {
				$downBuckets   += $runLength;
				$lastIncidentAt = ( $bucket - 1 ) * $step;
			}
			$runLength = 0;
			continue;
		}

		$runLength++;
	}

	// Незакрытая серия на конце окна.
	if ( $runLength >= 2 ) {
		$downBuckets   += $runLength;
		$lastIncidentAt = $lastBucket * $step;
	}

	$ratio   = ( $totalBuckets - $downBuckets ) / $totalBuckets;
	$percent = floor( $ratio * 1000 ) / 10; // вниз, до десятых

	// Сбоя в замерах не было — отсчёт ведём от последнего известного перерыва
	// до начала наблюдений (RENTOS_UPTIME_SEED), а не от первого замера:
	// иначе счётчик обнулялся бы каждый раз, когда монитор переставили.
	$seed = rentos_uptime_seed_timestamp();

	if ( null === $lastIncidentAt ) {
		$since = ( $seed && $seed < $firstStamp ) ? $seed : $firstStamp;
	} else {
		$since = $lastIncidentAt;
	}

	$daysOk  = (int) floor( ( $now - $since ) / DAY_IN_SECONDS );
	$window  = (int) floor( $totalBuckets / $bucketsInDay );

	// Медиана, а не среднее: одна подвисшая проверка не должна портить картину.
	$median = null;
	if ( count( $times ) >= 12 ) { // меньше часа замеров — рано о чём-то говорить
		sort( $times );
		$mid    = (int) floor( count( $times ) / 2 );
		$median = count( $times ) % 2
			? $times[ $mid ]
			: ( $times[ $mid - 1 ] + $times[ $mid ] ) / 2;
	}

	return array(
		// Медиана времени ответа в секундах, округлённая ВВЕРХ до сотых —
		// как и с процентом, приписывать себе лучшее не будем.
		'response'      => null === $median ? null : number_format( ceil( $median * 100 ) / 100, 2, '.', '' ),
		// Момент последнего сбоя (или базовая дата). Сколько с тех пор прошло,
		// шорткод считает сам при отрисовке — это бесплатно и не требует
		// пересчёта всей статистики.
		'since'         => $since,
		'has_incident'  => null !== $lastIncidentAt,
		// Дни без сбоев на момент пересчёта — по ним ловим, что видимая строка
		// изменилась, и чистим кэш (раз в сутки, когда число подрастает).
		'streak_days'   => $daysOk,
		'percent'       => number_format( $percent, 1, '.', '' ),
		'days_ok'       => $daysOk,
		'window_days'   => max( 1, $window ),
		'window_hours'  => (int) floor( $totalBuckets * $step / HOUR_IN_SECONDS ),
		'down_minutes'  => (int) round( $downBuckets * $step / 60 ),
		'samples'       => count( $keepLines ),
		'updated'       => $now,
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

	// Замер старше двух шагов — значит сборщик встал, молчим.
	if ( time() - (int) $stamp > 2 * RENTOS_UPTIME_STEP + MINUTE_IN_SECONDS ) {
		return false;
	}

	return (int) $code >= 200 && (int) $code < 300;
}

/* -------------------------------------------------------------------------
 * Вывод
 * ---------------------------------------------------------------------- */


/**
 * Базовая дата отсчёта «без сбоев» в отметке времени часового пояса сайта.
 */
function rentos_uptime_seed_timestamp() {
	if ( ! RENTOS_UPTIME_SEED ) {
		return 0;
	}

	$dt = date_create_immutable( RENTOS_UPTIME_SEED . ' 00:00:00', wp_timezone() );

	return $dt ? (int) $dt->getTimestamp() : 0;
}

/**
 * «5 дн.» / «1 day» / «1 zi» — единицы с правильным числом. Русский и
 * украинский сокращаем («дн.», «ч.»), там склонения не нужны; у английского,
 * итальянского и румынского форма зависит от числа.
 */
function rentos_uptime_unit( $n, $unit, $lang ) {
	$forms = array(
		'ru' => array( 'day' => array( '%d дн.', '%d дн.' ), 'hour' => array( '%d ч.', '%d ч.' ) ),
		'uk' => array( 'day' => array( '%d дн.', '%d дн.' ), 'hour' => array( '%d год.', '%d год.' ) ),
		'en' => array( 'day' => array( '%d day', '%d days' ), 'hour' => array( '%d hour', '%d hours' ) ),
		'it' => array( 'day' => array( '%d giorno', '%d giorni' ), 'hour' => array( '%d ora', '%d ore' ) ),
		'ro' => array( 'day' => array( '%d zi', '%d zile' ), 'hour' => array( '%d oră', '%d ore' ) ),
	);

	$set = isset( $forms[ $lang ] ) ? $forms[ $lang ] : $forms['en'];

	return sprintf( 1 === (int) $n ? $set[ $unit ][0] : $set[ $unit ][1], (int) $n );
}

/**
 * Сколько прошло с последнего сбоя. Считается ПРИ ОТРИСОВКЕ (это просто
 * вычитание, никаких файлов), поэтому суточный пересчёт не мешает строке
 * оставаться свежей.
 */
function rentos_uptime_streak_text( $since, $lang ) {
	$elapsed = max( 0, time() - (int) $since );
	$days    = (int) floor( $elapsed / DAY_IN_SECONDS );
	$hours   = (int) floor( $elapsed / HOUR_IN_SECONDS );

	if ( $days >= 1 ) {
		$value = rentos_uptime_unit( $days, 'day', $lang );
	} elseif ( $hours >= 1 ) {
		$value = rentos_uptime_unit( $hours, 'hour', $lang );
	} else {
		return ''; // меньше часа — писать нечего
	}

	$forms = array(
		'ru' => 'без сбоев %s',
		'uk' => 'без збоїв %s',
		'en' => '%s without incidents',
		'it' => '%s senza guasti',
		'ro' => '%s fără incidente',
	);

	return sprintf( isset( $forms[ $lang ] ) ? $forms[ $lang ] : $forms['en'], $value );
}

add_shortcode(
	'rentos_uptime',
	function () {
		$stats = get_option( RENTOS_UPTIME_OPTION );
		$lang  = substr( (string) determine_locale(), 0, 2 );

		$labels = array(
			'ru' => 'Сервис работает',
			'en' => 'Service is up',
			'uk' => 'Сервіс працює',
			'it' => 'Servizio attivo',
			'ro' => 'Serviciul funcționează',
		);

		$percentForms = array(
			'ru' => 'доступность %1$s%% за %2$s',
			'uk' => 'доступність %1$s%% за %2$s',
			'en' => '%1$s%% uptime over %2$s',
			'it' => 'disponibilità %1$s%% su %2$s',
			'ro' => 'disponibilitate %1$s%% în %2$s',
		);

		// Последний замер должен быть свежим и удачным — иначе не пишем ничего:
		// врать про «работает» во время аварии нельзя.
		if ( ! rentos_uptime_last_sample_ok() ) {
			return '';
		}

		$parts = array( isset( $labels[ $lang ] ) ? $labels[ $lang ] : $labels['en'] );

		// Пока статистики нет (первый час замеров), «без сбоев» всё равно
		// считаем — от базовой даты.
		if ( ! is_array( $stats ) || ! isset( $stats['since'] ) ) {
			$seed = rentos_uptime_seed_timestamp();

			if ( $seed ) {
				$streak = rentos_uptime_streak_text( $seed, $lang );
				if ( '' !== $streak ) {
					$parts[] = $streak;
				}
			}

			return '<span data-no-translation><span style="color:#22C55E">&#9679;</span> '
				. esc_html( implode( ' · ', $parts ) ) . '</span>';
		}

		if ( isset( $stats['percent'], $stats['since'] ) ) {
			// Процент показываем, только когда набрались сутки замеров:
			// «доступность 100% за 2 часа» — не статистика, а самообман.
			if ( (int) $stats['window_hours'] >= RENTOS_UPTIME_PCT_HOURS ) {
				// «100,0%» выглядит нелепо — целые проценты пишем без десятых.
				$percent = rtrim( rtrim( (string) $stats['percent'], '0' ), '.' );
				if ( '' === $percent ) {
					$percent = '0';
				}

				if ( in_array( $lang, array( 'ru', 'uk', 'it', 'ro' ), true ) ) {
					$percent = str_replace( '.', ',', $percent );
				}

				$form    = isset( $percentForms[ $lang ] ) ? $percentForms[ $lang ] : $percentForms['en'];
				$parts[] = sprintf( $form, $percent, rentos_uptime_unit( (int) $stats['window_days'], 'day', $lang ) );
			}

			// Медиана отклика — цифра, понятная клиенту («кабинет открывается
			// мгновенно»), в отличие от загрузки сервера.
			if ( ! empty( $stats['response'] ) ) {
				$responseForms = array(
					'ru' => 'отклик сервера %s с',
					'uk' => 'відгук сервера %s с',
					'en' => '%s s server response',
					'it' => 'risposta del server %s s',
					'ro' => 'răspuns server %s s',
				);

				$value = in_array( $lang, array( 'ru', 'uk', 'it', 'ro' ), true )
					? str_replace( '.', ',', $stats['response'] )
					: $stats['response'];

				$parts[] = sprintf(
					isset( $responseForms[ $lang ] ) ? $responseForms[ $lang ] : $responseForms['en'],
					$value
				);
			}

			$streak = rentos_uptime_streak_text( $stats['since'], $lang );
			if ( '' !== $streak ) {
				$parts[] = $streak;
			}
		}

		return '<span data-no-translation><span style="color:#22C55E">&#9679;</span> '
			. esc_html( implode( ' · ', $parts ) ) . '</span>';
	}
);
