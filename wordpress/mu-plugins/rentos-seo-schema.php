<?php
/**
 * Plugin Name: RentOS — разметка Schema.org
 * Description: Стабильные идентификаторы Organization/WebSite при мультиязычности и узел SoftwareApplication с тарифами.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Yoast хранит адрес главной в одной строке таблицы `wp_yoast_indexable` (object_type = home-page).
 * Строка общая на все языки, и если её собрал запрос переведённой версии, туда попадает адрес
 * с языковым префиксом — тогда Organization и WebSite на ВСЕХ языках начинают ссылаться,
 * например, на /ua/. Один раз это уже случилось. Здесь страхуемся: у этих двух узлов
 * идентификатор всегда без языкового префикса, потому что организация у сайта одна.
 */
function rentos_schema_strip_language_prefix( $url ) {
	return preg_replace( '#^(https?://[^/]+)/(en|ua|it|ro)/#', '$1/', (string) $url );
}

function rentos_schema_root_identity( $data ) {
	foreach ( [ '@id', 'url' ] as $key ) {
		if ( isset( $data[ $key ] ) ) {
			$data[ $key ] = rentos_schema_strip_language_prefix( $data[ $key ] );
		}
	}
	foreach ( [ 'publisher', 'isPartOf', 'logo', 'image' ] as $key ) {
		if ( isset( $data[ $key ]['@id'] ) ) {
			$data[ $key ]['@id'] = rentos_schema_strip_language_prefix( $data[ $key ]['@id'] );
		}
	}
	if ( isset( $data['potentialAction'] ) && is_array( $data['potentialAction'] ) ) {
		foreach ( $data['potentialAction'] as $i => $action ) {
			if ( isset( $action['target']['urlTemplate'] ) ) {
				$data['potentialAction'][ $i ]['target']['urlTemplate'] = rentos_schema_strip_language_prefix( $action['target']['urlTemplate'] );
			}
		}
	}
	return $data;
}
add_filter( 'wpseo_schema_organization', 'rentos_schema_root_identity' );
add_filter( 'wpseo_schema_website', 'rentos_schema_root_identity' );

/**
 * Ссылки на организацию и сайт раскиданы по остальным узлам графа (publisher, isPartOf).
 * Если их не поправить тем же образом, ссылки повиснут в пустоту.
 */
add_filter( 'wpseo_schema_graph', function ( $graph ) {
	foreach ( $graph as $i => $piece ) {
		$types = (array) ( $piece['@type'] ?? [] );
		if ( array_intersect( $types, [ 'Organization', 'WebSite' ] ) ) {
			continue;
		}
		foreach ( [ 'publisher', 'isPartOf', 'author' ] as $key ) {
			if ( isset( $piece[ $key ]['@id'] ) && str_contains( $piece[ $key ]['@id'], '#organization' ) ) {
				$graph[ $i ][ $key ]['@id'] = rentos_schema_strip_language_prefix( $piece[ $key ]['@id'] );
			}
			if ( isset( $piece[ $key ]['@id'] ) && str_contains( $piece[ $key ]['@id'], '#website' ) ) {
				$graph[ $i ][ $key ]['@id'] = rentos_schema_strip_language_prefix( $piece[ $key ]['@id'] );
			}
		}
	}
	return $graph;
}, 5 );

/**
 * На страницах архивов (рубрики блога и категории документации) хлебные крошки повисали
 * в пустоте: страница ссылается на `<адрес>#breadcrumb`, а узел BreadcrumbList получал
 * идентификатор ПОСЛЕДНЕЙ записи из цикла — схема собирается внутри The Loop. Сами ступеньки
 * при этом верные, поэтому достаточно вернуть узлу тот идентификатор, которого ждёт страница.
 */
add_filter( 'wpseo_schema_graph', function ( $graph ) {
	$expected = null;

	foreach ( $graph as $piece ) {
		$types = (array) ( $piece['@type'] ?? [] );
		if ( array_intersect( $types, [ 'WebPage', 'CollectionPage' ] ) && isset( $piece['breadcrumb']['@id'] ) ) {
			$expected = $piece['breadcrumb']['@id'];
			break;
		}
	}

	if ( ! $expected ) {
		return $graph;
	}

	$present = false;
	$list    = null;
	foreach ( $graph as $i => $piece ) {
		if ( ( $piece['@id'] ?? '' ) === $expected ) {
			$present = true;
			break;
		}
		if ( in_array( 'BreadcrumbList', (array) ( $piece['@type'] ?? [] ), true ) ) {
			$list = $i;
		}
	}

	if ( ! $present && null !== $list ) {
		$graph[ $list ]['@id'] = $expected;
	}

	return $graph;
}, 7 );

/**
 * Требование владельца: ни автора, ни даты в поисковой выдаче. Обе вещи попадают туда из
 * разметки — поэтому даты вычищаем из всех узлов графа, а вместе с ними убираем и парные
 * OG-теги `article:published_time` / `article:modified_time`. Автора Yoast и так не печатает:
 * авторские архивы на сайте отключены.
 */
add_filter( 'wpseo_schema_graph', function ( $graph ) {
	foreach ( $graph as $i => $piece ) {
		unset( $graph[ $i ]['datePublished'], $graph[ $i ]['dateModified'] );
	}
	return $graph;
}, 6 );

add_filter( 'wpseo_frontend_presenters', function ( $presenters ) {
	return array_filter(
		$presenters,
		static function ( $presenter ) {
			return ! ( $presenter instanceof \Yoast\WP\SEO\Presenters\Open_Graph\Article_Published_Time_Presenter )
				&& ! ( $presenter instanceof \Yoast\WP\SEO\Presenters\Open_Graph\Article_Modified_Time_Presenter );
		}
	);
} );

/**
 * Узел SoftwareApplication: продукт с тарифами. Печатается на главной и на странице цен —
 * там, где он уместен по содержимому страницы.
 */
add_filter( 'wpseo_schema_graph', function ( $graph, $context ) {
	if ( ! is_page() && ! is_front_page() ) {
		return $graph;
	}

	$page_id = get_queried_object_id();
	// 2 — Главная, 21 — Цены.
	if ( ! in_array( $page_id, [ 2, 21 ], true ) ) {
		return $graph;
	}

	$descriptions = [
		'ru_RU' => 'Облачная система учёта для проката и развлечений: счётчики, пуски, прибывания, билеты, деньги и кассы, рабочее время сотрудников. Работает с любого устройства.',
		'en_US' => 'Cloud management system for rental and entertainment venues: counters, launches, stays, tickets, money and cash registers, employee work time. Works on any device.',
		'uk'    => 'Хмарна система обліку для прокату та розваг: лічильники, заїзди, перебування, квитки, гроші й каси, робочий час співробітників. Працює з будь-якого пристрою.',
		'it_IT' => 'Sistema di gestione in cloud per noleggi e intrattenimento: contatori, corse, soggiorni, biglietti, cassa e denaro, orario dei dipendenti. Funziona da qualsiasi dispositivo.',
		'ro_RO' => 'Sistem cloud de evidență pentru închirieri și divertisment: contoare, curse, șederi, bilete, bani și case de marcat, timpul de lucru al angajaților. Funcționează de pe orice dispozitiv.',
	];
	$locale = get_locale();
	$desc   = $descriptions[ $locale ] ?? $descriptions['ru_RU'];

	$plans = [
		[ 'Starter', '12', '120' ],
		[ 'Pro', '29', '290' ],
		[ 'Max', '69', '690' ],
	];

	// Адрес страницы цен берём пермалинком: у переведённых версий свой слаг.
	$prices_url = get_permalink( 21 );

	$offers = [];
	foreach ( $plans as [ $name, $monthly, $yearly ] ) {
		$offers[] = [
			'@type'         => 'Offer',
			'name'          => $name,
			'price'         => $monthly,
			'priceCurrency' => 'USD',
			'url'           => $prices_url,
			'availability'  => 'https://schema.org/InStock',
			'priceSpecification' => [
				[
					'@type'         => 'UnitPriceSpecification',
					'price'         => $monthly,
					'priceCurrency' => 'USD',
					'billingDuration' => 1,
					'billingIncrement' => 1,
					'unitCode'      => 'MON',
				],
				[
					'@type'         => 'UnitPriceSpecification',
					'price'         => $yearly,
					'priceCurrency' => 'USD',
					'billingDuration' => 1,
					'unitCode'      => 'ANN',
				],
			],
		];
	}

	$graph[] = [
		'@type'               => 'SoftwareApplication',
		'@id'                 => rentos_schema_strip_language_prefix( home_url( '/' ) ) . '#software',
		'name'                => 'RentOS 365',
		'description'         => $desc,
		// Адрес языконезависимый: сущность одна, а её описание на странице — на языке страницы.
		'url'                 => rentos_schema_strip_language_prefix( home_url( '/' ) ),
		'applicationCategory' => 'BusinessApplication',
		'applicationSubCategory' => 'Rental management software',
		'operatingSystem'     => 'Web browser, iOS, Android',
		'inLanguage'          => [ 'ru', 'en', 'uk', 'it', 'ro' ],
		'publisher'           => [ '@id' => rentos_schema_strip_language_prefix( home_url( '/' ) ) . '#organization' ],
		'image'               => 'https://rentos365.app/wp-content/uploads/2026/08/overview.jpg',
		'offers'              => [
			[
				'@type'         => 'AggregateOffer',
				'lowPrice'      => '12',
				'highPrice'     => '69',
				'priceCurrency' => 'USD',
				'offerCount'    => count( $offers ),
				'url'           => $prices_url,
				'offers'        => $offers,
			],
		],
	];

	return $graph;
}, 20, 2 );
