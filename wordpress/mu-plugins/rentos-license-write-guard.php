<?php
/**
 * Plugin Name: RentOS — гасит паразитные записи лицензионных опций
 * Description: Сборки платных плагинов (Elementor Pro, Fluent Forms Pro, BetterDocs Pro,
 *              WP Rocket) переписывают опции своих «лицензий» на КАЖДОМ запросе: внутри
 *              значения меняется только отметка «когда проверять снова», всё остальное
 *              то же самое. Одна страница = 5 UPDATE в wp_options, ~14 000 записей на
 *              2 000 просмотров, ~460 МБ бинлогов MySQL в сутки при 450 МБ всех баз
 *              (замер 2026-08-23 по binlog.004211). Плагин пропускает такую запись не
 *              чаще раза в сутки: если новое значение отличается от старого ТОЛЬКО
 *              числами, похожими на unix-время, и сдвиг меньше суток — возвращаем старое
 *              значение, и update_option() сам ничего не пишет.
 *
 *              Настоящие изменения (лицензия стала invalid, сменился ключ, добавились
 *              features) проходят всегда — у них отличия не только во времени.
 *
 *              Родственник rentos-elementor-css-flush-guard.php: тот снимал ПОСЛЕДСТВИЕ
 *              этих записей у Elementor 4.2.3 (сброс _elementor_css), этот убирает саму
 *              запись. Оба нужны: раз в сутки запись всё же проходит.
 * Version:     1.0
 */

defined( 'ABSPATH' ) || exit;

// Как часто пропускать запись. Сутки — компромисс: «время следующей проверки» у этих
// опций живёт от 15 часов до 90 дней, то есть суточный шаг ничему не мешает, а поток
// записей падает с тысяч в час до одной в день на опцию.
const RENTOS_LIC_MIN_INTERVAL = DAY_IN_SECONDS;

// Опции, за которыми смотрим. Транзиенты перечислены обеими половинами: значение и его
// _timeout_ пишутся раздельно, и вторая половина как раз и есть чистая отметка времени.
const RENTOS_LIC_OPTIONS = array(
	'_elementor_pro_license_v2_data',
	'_ff_fluentform_pro_license_status_checking',
	'_transient_betterdocs_pro_software__license_data',
	'_transient_timeout_betterdocs_pro_software__license_data',
	'_transient_wp_rocket_customer_data',
	'_transient_timeout_wp_rocket_customer_data',
);

/**
 * Похоже ли число на unix-время. Границы намеренно широкие — 2001..2100: у этих плагинов
 * встречается и «проверить снова через 15 часов», и «лицензия действует до 2076 года»
 * (licence_expiration = 3364280105 у WP Rocket — на первой версии границы в 2065 эта метка
 * не распозналась, и дрейф WP Rocket проходил мимо фильтра). Важно лишь то, что это отметка
 * времени, а не лимит активаций, цена плана или id платежа — те на порядки меньше.
 */
function rentos_lic_is_timestamp( $value ) {
	if ( is_int( $value ) || is_float( $value ) ) {
		$number = (float) $value;
	} elseif ( is_string( $value ) && preg_match( '/^\d{10}$/', $value ) ) {
		$number = (float) $value;
	} else {
		return false;
	}

	return $number >= 1000000000 && $number <= 4102444800;
}

/**
 * Заменяет все временные метки маркером и складывает их сами в $stamps. Две нормализованные
 * копии совпадут ровно тогда, когда значения отличаются ТОЛЬКО временем.
 */
function rentos_lic_normalize( $value, array &$stamps ) {
	if ( rentos_lic_is_timestamp( $value ) ) {
		$stamps[] = (float) $value;

		return '@RENTOS_TS@';
	}

	if ( is_object( $value ) ) {
		// Объект и массив с тем же содержимым НЕ считаем одинаковыми: смена типа это уже
		// не дрейф времени. Поэтому класс попадает в результат.
		$value = array( '@RENTOS_OBJ@' => get_class( $value ) ) + get_object_vars( $value );
	}

	if ( is_array( $value ) ) {
		$out = array();
		foreach ( $value as $key => $item ) {
			$out[ $key ] = rentos_lic_normalize( $item, $stamps );
		}

		return $out;
	}

	return $value;
}

/**
 * Отличаются ли значения только временем — и меньше ли сдвиг суток.
 */
function rentos_lic_is_idle_write( $new_value, $old_value ) {
	$new_stamps = array();
	$old_stamps = array();

	$new_shape = rentos_lic_normalize( $new_value, $new_stamps );
	$old_shape = rentos_lic_normalize( $old_value, $old_stamps );

	// Сравнение сериализацией, а не ==: у вложенных структур это единственный способ
	// поймать и порядок ключей, и типы, не городя рекурсию второй раз.
	if ( maybe_serialize( $new_shape ) !== maybe_serialize( $old_shape ) ) {
		return false;
	}

	// Формы совпали, а меток нет вовсе — значит значение вообще не изменилось. Такую
	// запись update_option() отбросит и без нас, но пусть решение будет явным.
	if ( ! $new_stamps || ! $old_stamps ) {
		return true;
	}

	// Смотрим на самую дальнюю метку: именно её плагины и двигают вперёд («проверить
	// снова через N часов»). Прошли сутки — пропускаем запись, значение освежится.
	return ( max( $new_stamps ) - max( $old_stamps ) ) < RENTOS_LIC_MIN_INTERVAL;
}

foreach ( RENTOS_LIC_OPTIONS as $rentos_lic_option ) {
	add_filter(
		"pre_update_option_{$rentos_lic_option}",
		/**
		 * Вернув старое значение, мы не подменяем данные, а отменяем запись: update_option()
		 * применяет этот фильтр ДО сравнения с прежним значением и при совпадении выходит,
		 * не трогая ни базу, ни хуки update_option_*. Это штатный путь, файлы плагинов не
		 * трогаются и обновление их не сотрёт.
		 */
		static function ( $new_value, $old_value ) {
			return rentos_lic_is_idle_write( $new_value, $old_value ) ? $old_value : $new_value;
		},
		10,
		2
	);
}
