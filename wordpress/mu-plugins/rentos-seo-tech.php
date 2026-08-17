<?php
/**
 * Plugin Name: RentOS — техническая обвязка SEO
 * Description: hreflang без параметров, пагинация блога, карты сайта, заголовки ответа и мелочи из аудита.
 */

defined( 'ABSPATH' ) || exit;

/**
 * 1. hreflang не должен тащить строку запроса.
 *
 * TranslatePress собирает адреса альтернатив из текущего запроса, поэтому заход
 * с любой меткой (?ref=…, партнёрская ссылка) печатал hreflang с этой меткой внутри.
 * Google требует в hreflang канонические адреса и при таком расхождении игнорирует
 * весь набор. Фильтр включаем ровно на время вывода TP (его действие висит на wp_head, 10).
 */
add_action( 'wp_head', function () {
	add_filter( 'trp_pre_get_url_for_language', 'rentos_seo_strip_query_from_hreflang', 99 );
}, 9 );

add_action( 'wp_head', function () {
	remove_filter( 'trp_pre_get_url_for_language', 'rentos_seo_strip_query_from_hreflang', 99 );
}, 11 );

function rentos_seo_strip_query_from_hreflang( $url ) {
	$pos = strpos( (string) $url, '?' );
	return false === $pos ? $url : substr( $url, 0, $pos );
}

/**
 * 2. Пустая карта сайта в индексе.
 *
 * Все три товара FluentCart закрыты от индексации, карта `fluent-products-sitemap.xml`
 * пуста, но перечислена в индексе — Search Console считает это ошибкой.
 */
add_filter( 'wpseo_sitemap_exclude_post_type', function ( $excluded, $post_type ) {
	return 'fluent-products' === $post_type ? true : $excluded;
}, 10, 2 );

/**
 * 3. Пагинация ленты блога.
 *
 * `/blog/` — обычная страница Elementor с виджетом записей, поэтому Yoast не знает про
 * её пагинацию: вторая страница была открыта к индексации, но канонизирована на первую,
 * то есть сигналы противоречили друг другу. Даём странице собственный канонический адрес
 * и номер в заголовке.
 */
function rentos_seo_paged_number() {
	if ( ! preg_match( '#/page/(\d+)/?#', $_SERVER['REQUEST_URI'] ?? '', $m ) ) {
		return 0;
	}
	return (int) $m[1] > 1 ? (int) $m[1] : 0;
}

add_filter( 'wpseo_canonical', function ( $canonical ) {
	$page = rentos_seo_paged_number();
	if ( ! $page || ! $canonical ) {
		return $canonical;
	}
	// На настоящих архивах (рубрики блога, разделы документации) Yoast про пагинацию знает
	// и номер в канон уже поставил — второй раз дописывать нельзя, иначе выходит
	// /category/sovety/page/2/page/2/, то есть канонический адрес ведёт на 404.
	if ( preg_match( '#/page/\d+/?$#', $canonical ) ) {
		return $canonical;
	}
	return user_trailingslashit( trailingslashit( $canonical ) . 'page/' . $page );
} );

add_filter( 'wpseo_title', function ( $title ) {
	$page = rentos_seo_paged_number();
	if ( ! $page || ! $title ) {
		return $title;
	}
	// Номер ставим первым, чтобы он не потерялся при обрезке выдачи.
	return sprintf( '%s — %d', $title, $page );
} );

/**
 * 4. Ненужная предварительная связь с чужим доменом.
 *
 * Шрифт Inter лежит на своём сервере (его же и предзагружаем), а WordPress по привычке
 * печатает preconnect к fonts.gstatic.com — лишнее рукопожатие на каждой странице.
 */
add_filter( 'wp_resource_hints', function ( $urls, $relation ) {
	if ( 'preconnect' !== $relation ) {
		return $urls;
	}
	return array_values(
		array_filter(
			$urls,
			static function ( $u ) {
				$href = is_array( $u ) ? ( $u['href'] ?? '' ) : $u;
				return false === strpos( (string) $href, 'fonts.gstatic.com' );
			}
		)
	);
}, 10, 2 );

/**
 * 4.1. Иконка в хиро главной.
 *
 * Показывается 34×34, а в разметке у неё `srcset` без `sizes` — по спецификации браузер в таком
 * случае берёт самый крупный вариант, то есть файл 512 px на 19 КБ, и делает это дважды.
 * Атомарный виджет Elementor печатает `sizes` сам и не даёт его задать, поэтому проще убрать
 * у этого вложения набор вариантов совсем: нужный размер уже стоит в `src`.
 */
add_filter( 'wp_calculate_image_srcset', function ( $sources, $size_array, $image_src, $image_meta, $attachment_id ) {
	return 42 === (int) $attachment_id ? [] : $sources;
}, 10, 5 );

/**
 * 4.2. Страницы рубрик.
 *
 * Заголовок архива WordPress печатает с приставкой — «Рубрика: Советы». В выдаче и на самой
 * странице это лишнее слово, оно занимает место и ничего не сообщает.
 */
add_filter( 'get_the_archive_title_prefix', '__return_empty_string' );

/**
 * Описание рубрики виджетом Elementor не выводится (в теме-билдере такого элемента нет),
 * поэтому даём короткий шорткод — он печатает описание термина, если оно заполнено.
 */
add_shortcode( 'rentos_term_description', function () {
	if ( ! is_category() && ! is_tag() && ! is_tax() ) {
		return '';
	}
	$term = get_queried_object();
	if ( ! $term ) {
		return '';
	}

	$text = $term->description;

	// Описания рубрик мы писали как SEO-описания Yoast, поле термина осталось пустым —
	// берём оттуда, чтобы человек на странице видел то же, что и в выдаче.
	if ( ! $text ) {
		$meta = get_option( 'wpseo_taxonomy_meta', [] );
		$text = $meta[ $term->taxonomy ][ $term->term_id ]['wpseo_desc'] ?? '';
	}

	return $text ? wp_kses_post( wpautop( $text ) ) : '';
} );

/**
 * 5. Заголовки ответа.
 *
 * HTML отдавался вообще без указаний по кэшированию — браузер решал сам и держал копию
 * часами (на этом уже терялись правки: человек видел старую страницу и считал, что ничего
 * не применилось). Просим перепроверять, но разрешаем хранить копию.
 * Заодно ставим базовые заголовки безопасности, которых не было ни одного.
 */
add_action( 'send_headers', function () {
	if ( is_admin() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
		return;
	}

	header( 'X-Content-Type-Options: nosniff' );
	header( 'Referrer-Policy: strict-origin-when-cross-origin' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( 'Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()' );

	if ( ! is_user_logged_in() ) {
		header( 'Cache-Control: no-cache, must-revalidate, max-age=0' );
	}
}, 1 );

/**
 * 6. og:image:alt.
 *
 * Yoast печатает у картинки ширину, высоту и тип, но не подпись — а её читают вслух
 * программы чтения в лентах соцсетей. Подпись у вложений уже написана и переведена.
 * Печатаем сразу после блока Yoast (он выводится на wp_head с приоритетом 1).
 */
add_action( 'wp_head', function () {
	if ( is_admin() ) {
		return;
	}

	$image_id = 0;
	if ( is_singular() ) {
		$image_id = (int) get_post_meta( get_queried_object_id(), '_yoast_wpseo_opengraph-image-id', true );
		if ( ! $image_id ) {
			$image_id = (int) get_post_thumbnail_id( get_queried_object_id() );
		}
	}
	if ( ! $image_id ) {
		$social   = get_option( 'wpseo_social', [] );
		$image_id = (int) ( $social['og_default_image_id'] ?? 0 );
	}
	if ( ! $image_id ) {
		return;
	}

	$alt = get_post_meta( $image_id, '_wp_attachment_image_alt', true );
	if ( ! $alt ) {
		return;
	}

	echo '<meta property="og:image:alt" content="' . esc_attr( $alt ) . '" />' . "\n";
}, 2 );

/**
 * 7. twitter:image у записей и статей.
 *
 * Своя картинка для X у них не задавалась, и тег не печатался вовсе. X в этом случае
 * берёт og:image, но полагаться на запасной путь незачем — отдаём ту же картинку явно.
 */
add_filter( 'wpseo_twitter_image', function ( $image, $presentation = null ) {
	if ( $image ) {
		return $image;
	}
	if ( $presentation && ! empty( $presentation->open_graph_images ) ) {
		$first = reset( $presentation->open_graph_images );
		if ( ! empty( $first['url'] ) ) {
			return $first['url'];
		}
	}
	return $image;
}, 10, 2 );

/**
 * 8. robots.txt. Ядро WordPress само дописывает `Disallow: /wp-admin/`, но здесь строки не было
 * (её съедает Yoast, когда правил нет) — робот ходил в админку и собирал редиректы. Заодно
 * закрываем адреса единого входа: они некэшируемы, генерируются по 10 секунд, и именно на них
 * Googlebot ловил 504.
 */
add_filter( 'robots_txt', function ( $output ) {
	if ( false !== strpos( $output, '/wp-admin/' ) ) {
		return $output;
	}
	$rules  = "Disallow: /wp-admin/\n";
	$rules .= "Allow: /wp-admin/admin-ajax.php\n";
	$rules .= "Disallow: /*?rentos_sso=\n";
	$rules .= "Disallow: /*?fct_cart_hash=\n";

	// Yoast собирает свой блок сам и раньше нас, а заготовку ядра при этом отбрасывает —
	// поэтому дописываем в самом конце цепочки и целимся в строку внутри его блока.
	$anchor = "User-agent: *\n";
	$pos    = strrpos( $output, $anchor );
	if ( false === $pos ) {
		return rtrim( $output ) . "\n" . $rules;
	}
	$pos += strlen( $anchor );

	return substr( $output, 0, $pos ) . $rules . substr( $output, $pos );
}, PHP_INT_MAX );
