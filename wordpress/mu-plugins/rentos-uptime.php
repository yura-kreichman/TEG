<?php
/**
 * Plugin Name: RentOS — доступность сервиса
 * Description: Шорткод [rentos_uptime] для подвала: измеренная доступность my.rentos365.app, число дней без сбоев и текущая версия приложения со ссылкой на историю изменений.
 * Version: 1.0
 *
 * Откуда данные: скрипт uptime-monitor/check.sh раз в 5 минут дёргает
 * https://my.rentos365.app/api/health (там не «процесс жив», а реальный
 * SELECT 1 к Postgres) и дописывает строку «время,код» в samples.csv.
 * Файл лежит в корне сайта, но закрыт от HTTP правилом nginx
 * (vhosts-resources/rentos365.app/20-uptime-monitor.conf, deny all).
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

const RENTOS_UPTIME_FILE      = '/var/www/md33/data/www/rentos365.app/uptime-monitor/samples.csv';
const RENTOS_UPTIME_OPTION    = 'rentos_uptime_stats';
const RENTOS_UPTIME_WINDOW    = 30;      // дней в окне
const RENTOS_UPTIME_KEEP_DAYS = 45;      // сколько храним замеров
const RENTOS_UPTIME_MIN_HOURS = 1;       // меньше часа замеров — считать нечего
const RENTOS_UPTIME_PCT_HOURS = 24;      // процент показываем, только набрав сутки
const RENTOS_UPTIME_FOOTER_ID = 118;     // шаблон подвала Elementor

/**
 * Версия приложения второй строкой под состоянием (запрос владельца
 * 2026-08-25). Живёт здесь, а не отдельным плагином: та же строка подвала, тот
 * же шаблон, тот же кэш и то же часовое задание — разносить это по двум файлам
 * значило бы держать две копии одной и той же осторожности с уборкой кэша.
 *
 * Номер НЕ проставляется руками: единственный источник — /api/version самого
 * приложения, который отдаёт версию из собранной истории изменений
 * (changelog/README.md в репозитории RentOS).
 */
const RENTOS_VERSION_OPTION   = 'rentos_app_version';
const RENTOS_VERSION_ENDPOINT = 'https://my.rentos365.app/api/version';
const RENTOS_VERSION_PAGE     = 'https://my.rentos365.app/changelog';

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
 * Дни ДО запуска монитора, за которые работа сервиса подтверждена журналом
 * прод-базы: в эти сутки в приложении заводились пуски, операции и сдачи
 * итогов, то есть сервис реально обслуживал клиентов.
 *
 * Снято запросом к прод-базе 2026-08-22: активность есть каждый день с
 * 14.07.2026 по 21.08.2026, кроме 20.07.2026 (пустые сутки). Замеров за этот
 * период нет и быть не может — монитор запущен 22.08.2026, — поэтому на
 * графике такие дни рисуются ОТДЕЛЬНЫМ, более светлым оттенком: это
 * свидетельство работы, а не измеренная доступность.
 *
 * Список сам «состарится»: окно графика в 30 дней уедет вперёд, и эти даты из
 * него выпадут.
 */
const RENTOS_UPTIME_LOG_FROM = '2026-07-14';
const RENTOS_UPTIME_LOG_TO   = '2026-08-21';
const RENTOS_UPTIME_LOG_SKIP = '2026-07-20';

/**
 * Выкладки обновлений по дням — до запуска монитора. Каждая выкладка
 * пересоздаёт контейнер и даёт 30–60 секунд недоступности (видно в error-логе
 * nginx как «connect() failed»), поэтому такие дни на графике рисуются чуть
 * ниже: столбик показывает, что в этот день сервис обновляли.
 *
 * Источник — журнал пушей голого репозитория деплоя,
 * /srv/git/rentos.git/logs/HEAD: каждая запись «push» это одна выкладка.
 * Снято 2026-08-22, всего 347 записей с 11 июля. Даты сами выпадут из окна
 * в 30 дней.
 */
const RENTOS_UPTIME_DEPLOYS = array(
	'2026-07-14' => 13,
	'2026-07-15' => 3,
	'2026-07-16' => 14,
	'2026-07-17' => 5,
	'2026-07-18' => 9,
	'2026-07-19' => 17,
	'2026-07-20' => 12,
	'2026-07-21' => 8,
	'2026-07-22' => 18,
	'2026-07-23' => 13,
	'2026-07-24' => 12,
	'2026-07-25' => 24,
	'2026-07-26' => 6,
	'2026-07-27' => 19,
	'2026-07-28' => 21,
	'2026-07-29' => 7,
	'2026-07-30' => 2,
	'2026-07-31' => 6,
	'2026-08-02' => 3,
	'2026-08-03' => 3,
	'2026-08-04' => 6,
	'2026-08-05' => 1,
	'2026-08-06' => 5,
	'2026-08-08' => 7,
	'2026-08-09' => 1,
	'2026-08-10' => 5,
	'2026-08-12' => 2,
	'2026-08-13' => 16,
	'2026-08-14' => 5,
	'2026-08-15' => 10,
	'2026-08-16' => 20,
	'2026-08-17' => 5,
	'2026-08-18' => 2,
	'2026-08-19' => 2,
);

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

// Версию спрашиваем на каждом часовом тике, без суточного тормоза: это один
// лёгкий запрос, а не разбор файла замеров. Уборка кэша при этом всё равно
// случается редко — только когда номер реально сменился (см. функцию).
add_action( 'rentos_uptime_refresh', 'rentos_version_fetch' );

/**
 * Задание срабатывает раз в час и раз в час же делает работу.
 *
 * Раньше пересчёт был суточным — «разбор файла и уборка кэша тяжёлые». Оба
 * основания проверены 2026-08-31 и не подтвердились: разбор samples.csv
 * (2596 строк, 64 КБ) занимает 6–8 мс, а уборку кэша делает не эта функция —
 * rentos_uptime_recalculate() чистит кэш ТОЛЬКО когда меняется видимый текст
 * строки, и выходит раньше, если ничего не изменилось. То есть суточный
 * тормоз экономил миллисекунды, а стоил суток вранья.
 *
 * Цену увидели в тот же день: сервер лежал дважды (переезд на новый хостинг
 * и перезагрузка провайдером), а подвал продолжал показывать «доступность
 * 100%, без сбоев 51 дн.» — последний пересчёт был накануне вечером. Теперь
 * правда отстаёт максимум на час.
 */
function rentos_uptime_maybe_recalculate() {
	$stats = get_option( RENTOS_UPTIME_OPTION );

	if ( is_array( $stats ) && ! empty( $stats['updated'] ) ) {
		$age = time() - (int) $stats['updated'];

		// Минута запаса: часовой тик cron приходит с собственной задержкой,
		// и ровно HOUR_IN_SECONDS он бы регулярно проскакивал.
		$limit = HOUR_IN_SECONDS - MINUTE_IN_SECONDS;

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

	// Доступность по календарным дням — для полоски-графика в расшифровке.
	// День без единого замера остаётся null и рисуется бледной заглушкой:
	// так график выглядит осмысленно с первого дня, а не как одинокий столбик.
	$tzOffset = wp_timezone()->getOffset( new DateTimeImmutable( '@' . $now ) );
	$today    = (int) floor( ( $now + $tzOffset ) / DAY_IN_SECONDS );
	$firstDay = (int) floor( ( $firstStamp + $tzOffset ) / DAY_IN_SECONDS );

	$dayOk = array();
	$dayAll = array();

	for ( $bucket = $windowStart; $bucket <= $lastBucket; $bucket++ ) {
		$day = (int) floor( ( $bucket * $step + $tzOffset ) / DAY_IN_SECONDS );

		if ( ! isset( $dayAll[ $day ] ) ) {
			$dayAll[ $day ] = 0;
			$dayOk[ $day ]  = 0;
		}

		$dayAll[ $day ]++;
		if ( ! empty( $byBucket[ $bucket ] ) ) {
			$dayOk[ $day ]++;
		}
	}

	// Дни, подтверждённые журналом прод-базы (см. RENTOS_UPTIME_LOG_*).
	$logFrom = (int) floor( ( strtotime( RENTOS_UPTIME_LOG_FROM . ' 12:00:00' ) + $tzOffset ) / DAY_IN_SECONDS );
	$logTo   = (int) floor( ( strtotime( RENTOS_UPTIME_LOG_TO . ' 12:00:00' ) + $tzOffset ) / DAY_IN_SECONDS );
	$logSkip = (int) floor( ( strtotime( RENTOS_UPTIME_LOG_SKIP . ' 12:00:00' ) + $tzOffset ) / DAY_IN_SECONDS );

	$days = array();
	for ( $d = RENTOS_UPTIME_WINDOW - 1; $d >= 0; $d-- ) {
		$day = $today - $d;

		if ( $day < $firstDay || empty( $dayAll[ $day ] ) ) {
			// Замеров нет. Если работа за эти сутки подтверждена журналом —
			// рисуем светлым столбиком, иначе оставляем пустое место.
			if ( $day < $logFrom || $day > $logTo || $day === $logSkip ) {
				$days[] = null;
				continue;
			}

			// День выкладки обновлений — столбик чуть ниже. Индекс суток,
			// умноженный на длину суток, даёт полночь по UTC, чья ДАТА
			// совпадает с местной, поэтому gmdate здесь корректен.
			$date      = gmdate( 'Y-m-d', $day * DAY_IN_SECONDS );
			$deploys   = isset( RENTOS_UPTIME_DEPLOYS[ $date ] ) ? (int) RENTOS_UPTIME_DEPLOYS[ $date ] : 0;
			$days[]    = $deploys > 0 ? 'log:' . $deploys : 'log';
			continue;
		}

		// Храним ЧИСЛО неудачных корзин, а не долю. Доля в начале суток врёт:
		// пока замеров всего два десятка, одна осечка от деплоя даёт 96%, то
		// есть день красится как авария. Абсолютные пять минут простоя
		// выглядят одинаково и утром, и вечером.
		$days[] = (int) ( $dayAll[ $day ] - $dayOk[ $day ] );
	}

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
		// Доступность по дням для графика: 30 значений, oldest → newest.
		'days'          => $days,
		// Момент последнего сбоя (или базовая дата). Сколько с тех пор прошло,
		// шорткод считает сам при отрисовке — это бесплатно и не требует
		// пересчёта всей статистики.
		'since'         => $since,
		'has_incident'  => null !== $lastIncidentAt,
		// С какого момента вообще идут замеры — для расшифровки в подсказке.
		'monitor_since' => $firstStamp,
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
 * Расшифровка под строкой состояния. Держим её КОРОТКОЙ: две строки, без дат и
 * без объяснений методики (правка владельца 2026-08-22 — предыдущая версия из
 * четырёх строк с датами и определением сбоя была признана перегруженной).
 * Вместо «время ответа считается так-то» — сама цифра.
 */
function rentos_uptime_tooltip( $stats, $lang ) {
	$step = (int) round( RENTOS_UPTIME_STEP / 60 );

	$checkForms = array(
		'ru' => 'Проверка: my.rentos365.app - %d мин.',
		'uk' => 'Перевірка: my.rentos365.app - %d хв.',
		'en' => 'Check: my.rentos365.app - %d min.',
		'it' => 'Controllo: my.rentos365.app - %d min.',
		'ro' => 'Verificare: my.rentos365.app - %d min.',
	);

	$responseForms = array(
		'ru' => 'Время ответа: %s с.',
		'uk' => 'Час відповіді: %s с.',
		'en' => 'Response time: %s s.',
		'it' => 'Tempo di risposta: %s s.',
		'ro' => 'Timp de răspuns: %s s.',
	);

	$lines = array( sprintf( isset( $checkForms[ $lang ] ) ? $checkForms[ $lang ] : $checkForms['en'], $step ) );

	if ( is_array( $stats ) && ! empty( $stats['response'] ) ) {
		$value = in_array( $lang, array( 'ru', 'uk', 'it', 'ro' ), true )
			? str_replace( '.', ',', $stats['response'] )
			: $stats['response'];

		$lines[] = sprintf( isset( $responseForms[ $lang ] ) ? $responseForms[ $lang ] : $responseForms['en'], $value );
	}

	return implode( "\n", $lines );
}


/**
 * Полоска доступности по дням — инлайновый SVG, который рисует сервер. Никакого
 * JS и никаких библиотек: 30 столбиков, зелёный = день без сбоев, бледный =
 * дней ещё не было (до запуска монитора). Так график осмысленно выглядит уже
 * в первый день и заполняется сам.
 */
function rentos_uptime_chart( $days ) {
	if ( ! is_array( $days ) || ! $days ) {
		return '';
	}

	$barW = 5;
	$gap  = 2;
	$h    = 26;
	$w    = count( $days ) * ( $barW + $gap ) - $gap;

	$bars = '';
	$x    = 0;

	foreach ( $days as $bad ) {
		if ( null === $bad ) {
			$color  = '#E5E3F5'; // нет ни замеров, ни следов в журнале
			$height = 6;
		} elseif ( 'log' === $bad || ( is_string( $bad ) && 0 === strpos( $bad, 'log:' ) ) ) {
			// Работа подтверждена журналом прод-базы, но замеров нет —
			// светлее измеренных дней, чтобы не выдавать одно за другое.
			$color   = '#A7E7C0';
			$deploys = ( 'log' === $bad ) ? 0 : (int) substr( $bad, 4 );

			// Дни, когда выкладывали обновления, — ниже: каждая выкладка это
			// полминуты недоступности.
			if ( 0 === $deploys ) {
				$height = $h;
			} elseif ( $deploys <= 2 ) {
				$height = (int) round( $h * 0.88 );
			} elseif ( $deploys <= 9 ) {
				$height = (int) round( $h * 0.8 );
			} else {
				$height = (int) round( $h * 0.72 );
			}
		} else {
			// Ступени по МИНУТАМ простоя, а не по доле: деплой это всегда
			// «одна-две неудачные проверки», сколько бы замеров ни было в
			// сутках. Владелец просил, чтобы такой день был «чуть ниже».
			$bad = (int) $bad;

			if ( 0 === $bad ) {
				$color  = '#22C55E';
				$height = $h;
			} elseif ( $bad <= 2 ) {          // до 10 минут — деплой, осечка
				$color  = '#22C55E';
				$height = (int) round( $h * 0.75 );
			} elseif ( $bad <= 12 ) {         // до часа
				$color  = '#F59E0B';
				$height = (int) round( $h * 0.55 );
			} elseif ( $bad <= 48 ) {         // до четырёх часов
				$color  = '#F59E0B';
				$height = (int) round( $h * 0.4 );
			} else {
				$color  = '#EF4444';
				$height = (int) round( $h * 0.28 );
			}
		}

		$bars .= sprintf(
			'<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="%s"/>',
			$x,
			$h - $height,
			$barW,
			$height,
			$color
		);

		$x += $barW + $gap;
	}

	return '<svg width="' . $w . '" height="' . $h . '" viewBox="0 0 ' . $w . ' ' . $h . '" role="img" aria-hidden="true" style="display:block;margin:6px 0 2px">' . $bars . '</svg>';
}

/**
 * Обёртка строки состояния: сама строка плюс кликабельное «подробнее», которое
 * раскрывает расшифровку прямо в подвале.
 *
 * Родной <details> — раскрытие без единой строчки JS и CSS. Нативной подсказки
 * (title) оказалось мало: она требует секунду наведения ровно по тексту, и в
 * тонкой строке подвала владелец её просто не увидел (2026-08-22). Слово
 * «подробнее» покрашено в акцент и подчёркнуто — выглядит как ссылка, то есть
 * очевидно кликабельно.
 */
function rentos_uptime_wrap( $line, $stats, $lang ) {
	$more = array(
		'ru' => 'подробнее',
		'uk' => 'докладніше',
		'en' => 'details',
		'it' => 'dettagli',
		'ro' => 'detalii',
	);

	$word  = isset( $more[ $lang ] ) ? $more[ $lang ] : $more['en'];
	$lines = explode( "\n", rentos_uptime_tooltip( $stats, $lang ) );

	// Всё содержимое — строчные элементы: виджет «Текстовый редактор» кладёт
	// вывод внутрь <p>, и первый же <div> заставил бы парсер закрыть абзац.
	$body = '';
	foreach ( $lines as $text ) {
		$body .= '<span style="display:block">' . esc_html( $text ) . '</span>';
	}

	if ( is_array( $stats ) && ! empty( $stats['days'] ) ) {
		// Короткие просадки — это выкладка обновлений, и смотрящий должен это
		// понимать, иначе читает их как аварии (правка владельца 2026-08-22).
		// Приписку даём, только если такие дни на графике ЕСТЬ и они мелкие:
		// называть обновлением настоящий простой было бы враньём.
		$hasSmallDip = false;
		foreach ( $stats['days'] as $bad ) {
			$measuredDip = is_int( $bad ) && $bad > 0 && $bad <= 2;
			$deployDay   = is_string( $bad ) && 0 === strpos( $bad, 'log:' );

			if ( $measuredDip || $deployDay ) {
				$hasSmallDip = true;
				break;
			}
		}

		if ( $hasSmallDip ) {
			$dips = array(
				'ru' => 'Просадки: обновления.',
				'uk' => 'Просадки: оновлення.',
				'en' => 'Dips: updates.',
				'it' => 'Cali: aggiornamenti.',
				'ro' => 'Scăderi: actualizări.',
			);

			$body .= '<span style="display:block">' . esc_html( isset( $dips[ $lang ] ) ? $dips[ $lang ] : $dips['en'] ) . '</span>';
		}

		$body .= rentos_uptime_chart( $stats['days'] );
	}

	// Карточка всплывает на наведении, а на тач-устройствах — по тапу, через
	// :focus-within (поэтому у строки tabindex). Оформление — в Custom CSS
	// набора Elementor, класс .rentos-status: согласованное исключение из
	// запрета на свой CSS (владелец, 2026-08-22) — нативный tooltip его не
	// устроил, на телефоне он не существует вовсе.
	// Значок «i» вместо слова (правка владельца 2026-08-22). Рисуем инлайновым
	// SVG в стиле Lucide — той же библиотеки, что и остальные иконки сайта:
	// шрифтовых значков тут нет, а «ⓘ» из юникода в разных шрифтах выглядит
	// по-разному. aria-label оставляет смысл программам чтения.
	$icon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
		. ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img"'
		. ' aria-label="' . esc_attr( $word ) . '" style="vertical-align:-2px">'
		. '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

	// Переключатель-флажок: тап по значку открывает карточку, повторный —
	// закрывает (правка владельца 2026-08-22; на :focus-within обратный тап не
	// закрывал, фокус оставался на элементе). Наведение мышью работает
	// отдельным правилом и флажка не требует. Скрипта по-прежнему ноль.
	$toggleId = 'rentos-status-toggle';

	return '<span class="rentos-status" data-no-translation>'
		. '<input type="checkbox" id="' . $toggleId . '" class="rentos-status__toggle">'
		. '<span class="rentos-status__line">'
		. '<span style="color:#22C55E">&#9679;</span> ' . esc_html( $line ) . ' '
		. '<label for="' . $toggleId . '" class="rentos-status__icon">' . $icon . '</label>'
		. '</span>'
		. '<span class="rentos-status__pop">' . $body . '</span>'
		. '</span>'
		// Версия — СНАРУЖИ .rentos-status: всплывающая карточка позиционируется
		// относительно этого элемента, и блок внутри него сдвинул бы её.
		. rentos_version_line();
}

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

/* -------------------------------------------------------------------------
 * Версия приложения
 * ---------------------------------------------------------------------- */

/**
 * Тянет номер версии у приложения и кладёт в опцию.
 *
 * Приложение недоступно или ответило чем-то неожиданным — молча оставляем
 * прошлое значение. Пустая строка выглядела бы как поломка сайта, хотя сайт-то
 * как раз жив; устаревший на час номер не врёт ни о чём важном.
 */
function rentos_version_fetch() {
	$response = wp_remote_get(
		RENTOS_VERSION_ENDPOINT,
		array(
			'timeout' => 8,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return;
	}

	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $data ) || empty( $data['version'] ) ) {
		return;
	}

	// Строгая форма «1.2.3»: любой лишний символ здесь означал бы, что мы
	// разбираем не тот ответ, а мусору в подвале сайта делать нечего.
	$version = (string) $data['version'];
	if ( ! preg_match( '/^\d+\.\d+\.\d+$/', $version ) ) {
		return;
	}

	$previous = get_option( RENTOS_VERSION_OPTION );
	update_option( RENTOS_VERSION_OPTION, array( 'version' => $version, 'checked' => time() ), false );

	// Номер меняется не чаще раза в сутки, поэтому полная уборка кэша ради него
	// — редкая операция. Пока номер тот же, не трогаем ничего: ровно тот же
	// принцип, что и у чисел доступности выше.
	if ( is_array( $previous ) && isset( $previous['version'] ) && $previous['version'] === $version ) {
		return;
	}

	delete_post_meta( RENTOS_UPTIME_FOOTER_ID, '_elementor_element_cache' );
	delete_post_meta( RENTOS_UPTIME_FOOTER_ID, '_elementor_element_cache_unique_id' );

	if ( function_exists( 'rocket_clean_domain' ) ) {
		rocket_clean_domain();
	}

	rentos_uptime_warm_cache();
}

/**
 * Строка «Версия: 1.22.1 — Обновления» отдельным блоком под состоянием.
 *
 * Отдельной строкой, а не через « · » в общей: строка состояния и так длинная
 * («Сервис работает · доступность 100% за 30 дн. · без сбоев 3 дн.»), и на
 * телефоне четвёртый кусок гнал бы её на третий перенос.
 *
 * Номер вместе с подписью помечен data-no-translation: строку мы собираем по
 * языкам сами, а словарь TranslatePress запомнил бы номер версии как
 * переводимый текст и оставил на страницах старый.
 */
function rentos_version_line() {
	$stored = get_option( RENTOS_VERSION_OPTION );

	if ( ! is_array( $stored ) || empty( $stored['version'] ) ) {
		return '';
	}

	$lang = substr( (string) determine_locale(), 0, 2 );

	// «Версия» — с большой буквы (решение владельца 2026-08-25).
	$labels = array(
		'ru' => 'Версия',
		'en' => 'Version',
		'uk' => 'Версія',
		'it' => 'Versione',
		'ro' => 'Versiune',
	);

	// Слово-ссылка: по-русски и по-украински — своё, в остальных языках
	// международное «Changelog» (решение владельца 2026-08-25).
	$links = array(
		'ru' => 'Обновления',
		'uk' => 'Оновлення',
		'en' => 'Changelog',
		'it' => 'Changelog',
		'ro' => 'Changelog',
	);

	$label = isset( $labels[ $lang ] ) ? $labels[ $lang ] : $labels['en'];
	$link  = isset( $links[ $lang ] ) ? $links[ $lang ] : $links['en'];

	// Язык передаём параметром: страница живёт на другом домене и о
	// TranslatePress ничего не знает — тот же приём, что у ссылок в
	// rentos-app-language-link.php.
	$href = add_query_arg( 'lang', $lang, RENTOS_VERSION_PAGE );

	// Новая вкладка (решение владельца 2026-08-25): уход на приложение не
	// должен закрывать страницу, которую человек читал.
	return '<span class="rentos-version" data-no-translation style="display:block">'
		. esc_html( $label ) . ': ' . esc_html( $stored['version'] ) . ' — '
		. '<a href="' . esc_url( $href ) . '" target="_blank" rel="noopener">' . esc_html( $link ) . '</a>'
		. '</span>';
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

		// Последний замер должен быть свежим и удачным — иначе про состояние не
		// пишем ничего: врать про «работает» во время аварии нельзя. Версию при
		// этом показываем: она к состоянию сервиса отношения не имеет, и её
		// исчезновение читалось бы как ещё одна поломка.
		if ( ! rentos_uptime_last_sample_ok() ) {
			return rentos_version_line();
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

			return rentos_uptime_wrap( implode( ' · ', $parts ), $stats, $lang );
		}

		if ( isset( $stats['percent'], $stats['since'] ) ) {
			// Окно называем честно: пока суток не набралось — в часах. Прятать
			// процент до суток оказалось хуже: владелец открывал расшифровку и
			// не видел ни одной цифры (2026-08-22).
			{
				// «100,0%» выглядит нелепо — целые проценты пишем без десятых.
				$percent = rtrim( rtrim( (string) $stats['percent'], '0' ), '.' );
				if ( '' === $percent ) {
					$percent = '0';
				}

				if ( in_array( $lang, array( 'ru', 'uk', 'it', 'ro' ), true ) ) {
					$percent = str_replace( '.', ',', $percent );
				}

				$windowHours = (int) $stats['window_hours'];
				$windowUnit  = $windowHours >= RENTOS_UPTIME_PCT_HOURS
					? rentos_uptime_unit( (int) $stats['window_days'], 'day', $lang )
					: rentos_uptime_unit( max( 1, $windowHours ), 'hour', $lang );

				$form    = isset( $percentForms[ $lang ] ) ? $percentForms[ $lang ] : $percentForms['en'];
				$parts[] = sprintf( $form, $percent, $windowUnit );
			}

			// Время ответа В СТРОКЕ не печатаем: оно переехало в расшифровку под
			// «подробнее» (правка владельца 2026-08-22 — строка и так длинная,
			// а цифра дублировалась бы в двух местах).

			$streak = rentos_uptime_streak_text( $stats['since'], $lang );
			if ( '' !== $streak ) {
				$parts[] = $streak;
			}
		}

		return rentos_uptime_wrap( implode( ' · ', $parts ), $stats, $lang );
	}
);
