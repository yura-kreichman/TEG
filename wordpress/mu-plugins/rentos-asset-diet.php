<?php
/**
 * Plugin Name: RentOS — снятие лишних ассетов
 * Description: Убирает CSS/JS плагинов со страниц, где они не используются. Причина: на публичных
 *              страницах грузилось ~100 файлов при смешном весе, и на мобильном канале счёт идёт
 *              по числу соединений, а не по байтам (Lighthouse mobile 78-80, FCP 2.2 c).
 * Author: RentOS
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Страницы FluentCart: магазин, корзина, оформление, кабинет.
 * Слаги могут быть переведены, поэтому опираемся на ID.
 */
function rentos_ad_fluent_cart_page_ids() {
	static $ids = null;

	if ( null === $ids ) {
		$ids = [];
		foreach ( [ 'shop', 'cart', 'checkout', 'account' ] as $slug ) {
			$page = get_page_by_path( $slug );
			if ( $page ) {
				$ids[] = (int) $page->ID;
			}
		}
	}

	return $ids;
}

/**
 * Содержимое текущей записи вместе с данными Elementor: виджеты живут в мете, а не в post_content.
 */
function rentos_ad_haystack() {
	static $haystack = null;

	if ( null !== $haystack ) {
		return $haystack;
	}

	$haystack = '';
	$object   = get_queried_object();

	if ( $object instanceof WP_Post ) {
		$haystack = (string) $object->post_content;
		$data     = get_post_meta( $object->ID, '_elementor_data', true );
		if ( is_string( $data ) ) {
			$haystack .= $data;
		}
	}

	return $haystack;
}

function rentos_ad_needs( $marker ) {
	return false !== strpos( rentos_ad_haystack(), $marker );
}

/**
 * Какие плагины на этой странице не нужны.
 */
function rentos_ad_unneeded_slugs() {
	// Эти на фронтенде не нужны никогда: первый — инструмент редактирования, второй — админский.
	$slugs = [ 'emcp-pro', 'wp-media-folder' ];

	// Важно: одной подстроки «fluent-cart» мало. На «Ценах» кнопки — обычные ссылки вида
	// ?fluent-cart=instant_checkout, им скрипты магазина не нужны. Ищем именно блок/шорткод/виджет.
	$cart_markup = rentos_ad_needs( 'wp:fluent-cart' )
		|| rentos_ad_needs( '[fluent_cart' )
		|| rentos_ad_needs( '[fluentcart' )
		|| rentos_ad_needs( 'fluent-cart-elementor' )
		|| rentos_ad_needs( 'fluentcart_' );

	$is_cart_page = is_page( rentos_ad_fluent_cart_page_ids() );
	if ( ! $is_cart_page && ! $cart_markup ) {
		$slugs[] = 'fluent-cart';
		$slugs[] = 'fluent-cart-pro';
		$slugs[] = 'fluentcartpro-160';
		$slugs[] = 'fluent-cart-elementor-blocks';
	}

	if ( ! rentos_ad_needs( 'fluentform' ) && ! rentos_ad_needs( 'fluent_form' ) ) {
		$slugs[] = 'fluentform';
		$slugs[] = 'fluentformpro';
	}

	$is_docs = is_singular( 'docs' ) || is_post_type_archive( 'docs' ) || is_tax( 'doc_category' ) || is_tax( 'knowledge_base' );
	if ( ! $is_docs && ! rentos_ad_needs( 'betterdocs' ) ) {
		$slugs[] = 'betterdocs';
		$slugs[] = 'betterdocs-pro';
	}

	return $slugs;
}

/**
 * ПРОВЕРЕНО И ОТКЛОНЕНО (2026-08-11): снятие библиотек UAE поштучно.
 * Карусели изображений нужен только slick, а isotope, fancybox, justifiedgallery, masonry
 * с imagesloaded выглядят мёртвым грузом — восемь файлов. Но `uael-frontend.min.js` вызывает
 * `.fancybox()` и `imagesLoaded` БЕЗУСЛОВНО, до инициализации slick: без них скрипт падает
 * с TypeError, и карусель не инициализируется вовсе (slick-initialized отсутствует, слайдов 0).
 * Экономия шести запросов не стоит поломки, поэтому библиотеки не трогаем.
 */

function rentos_ad_dequeue() {
	if ( is_admin() ) {
		return;
	}

	// Редактор Elementor и служебные переходы магазина не трогаем.
	if ( isset( $_GET['elementor-preview'] ) || isset( $_GET['fluent-cart'] ) || isset( $_GET['fct_cart_hash'] ) ) {
		return;
	}

	// Служебные страницы Fluent Forms: предпросмотр и конструктор дизайна открываются по адресу
	// вида /?fluent_forms_pages=1&design_mode=1&preview_id=3 — там нет содержимого с формой,
	// проверка по контенту не срабатывает, и диета сносила все файлы формы (найдено 2026-08-11).
	foreach ( [ 'fluent_forms_pages', 'design_mode', 'preview_id', 'fluent_forms', 'fluentform_pages' ] as $param ) {
		if ( isset( $_GET[ $param ] ) ) {
			return;
		}
	}

	// Кто может редактировать — видит страницу со всеми ассетами: конструкторы и предпросмотры
	// не должны ломаться. Клиентам (роль rentos_client) диета применяется как обычно.
	if ( is_preview() || current_user_can( 'edit_posts' ) ) {
		return;
	}

	if ( function_exists( 'is_checkout' ) && is_checkout() ) {
		return;
	}

	$slugs = rentos_ad_unneeded_slugs();
	if ( ! $slugs ) {
		return;
	}


	foreach ( [ wp_styles(), wp_scripts() ] as $registry ) {
		if ( ! $registry instanceof WP_Dependencies ) {
			continue;
		}

		foreach ( $registry->registered as $handle => $item ) {
			if ( empty( $item->src ) || ! is_string( $item->src ) ) {
				continue;
			}

			// FluentCart печатает разметку модального окна оформления и корзины-шторки на КАЖДОЙ
			// странице. Скрывают их не инлайновые стили, а эти два файла (position: fixed).
			// Снимешь — блок вываливается в поток и добавляет пустую полосу под подвалом.
			if ( preg_match( '#/(modal-checkout|cart-drawer)[.-]#', $item->src ) ) {
				continue;
			}

			// ПРОВЕРЕНО И ОТКЛОНЕНО (2026-08-11): снятие `spectre-icons-admin.css`.
			// Название врёт: в файле лежат фронтенд-правила отрисовки иконок, включая
			// `.spectre-icon--style-outline svg { fill: none; stroke: currentColor }`.
			// Без него ВСЕ контурные иконки Lucide заливаются сплошным цветом —
			// на «Возможностях» так залились все 27 Info Box. Файл не трогаем.

			// Font Awesome тянет Ultimate Addons безусловно, под свои соцсети и шаринг.
			// Иконки на сайте — Lucide в виде SVG (эксперимент e_font_icon_svg включён),
			// разметки `fa-` нет ни на одной странице. Проверяем данные страницы: как только
			// где-то появится иконка из библиотеки FontAwesome, файлы вернутся сами.
			if ( preg_match( '#/lib/font-awesome/#', $item->src ) && ! rentos_ad_needs( '"library":"fa-' ) ) {
				$registry->dequeue( $handle );
				continue;
			}

			foreach ( $slugs as $slug ) {
				if ( false !== strpos( $item->src, '/plugins/' . $slug . '/' ) ) {
					$registry->dequeue( $handle );
					break;
				}
			}
		}
	}
}
/**
 * Стили сохранённых шаблонов Elementor ставит в очередь в момент их отрисовки, то есть уже
 * в теле страницы. На «Ценах» из-за этого карточки тарифов сначала рисуются без оформления,
 * потом стили приезжают — и блок прыгает: CLS 0.451 при нулевых прочих метриках.
 * Ставим стили шаблонов в очередь заранее, чтобы они попали в <head>.
 */
function rentos_ad_preload_template_css() {
	if ( is_admin() || ! class_exists( '\Elementor\Core\Files\CSS\Post' ) ) {
		return;
	}

	$object = get_queried_object();
	if ( ! $object instanceof WP_Post ) {
		return;
	}

	$data = get_post_meta( $object->ID, '_elementor_data', true );
	if ( ! is_string( $data ) || '' === $data ) {
		return;
	}

	// Ссылки на шаблоны: сохранённые контейнеры переключателя, шаблоны циклов и т.п.
	if ( ! preg_match_all( '/"(?:section_saved_container_\d+|section_saved_section_\d+|template_id|saved_container_id)"\s*:\s*"?(\d+)"?/', $data, $matches ) ) {
		return;
	}

	foreach ( array_unique( $matches[1] ) as $template_id ) {
		$template_id = (int) $template_id;
		if ( $template_id && get_post_status( $template_id ) ) {
			\Elementor\Core\Files\CSS\Post::create( $template_id )->enqueue();
		}
	}
}
add_action( 'wp_enqueue_scripts', 'rentos_ad_preload_template_css', 20 );

/**
 * Masonry. На сайте нет ни одной кладки: разметки `masonry`/`isotope` нет ни на одной публичной
 * странице, а два файла ядра грузятся везде — и мостик `jquery.masonry.min.js` при этом падает
 * с `Cannot read properties of undefined (reading 'prototype')`, потому что глобального `Masonry`
 * рядом не оказывается (сказывается общий defer от WP Rocket). Это единственная ошибка в консоли
 * сайта. Снимаем оба файла; появится настоящая кладка в разметке — вернутся сами.
 *
 * Снимается для всех, включая редакторов: к конструкторам это отношения не имеет,
 * а ошибка в консоли мешает диагностике.
 */
function rentos_ad_drop_masonry() {
	if ( is_admin() || isset( $_GET['elementor-preview'] ) ) {
		return;
	}
	if ( rentos_ad_needs( 'masonry' ) || rentos_ad_needs( 'isotope' ) ) {
		return;
	}
	wp_dequeue_script( 'jquery-masonry' );
	wp_dequeue_script( 'masonry' );
}
add_action( 'wp_print_scripts', 'rentos_ad_drop_masonry', 0 );
add_action( 'wp_print_footer_scripts', 'rentos_ad_drop_masonry', 0 );

// Часть плагинов (FluentCart) ставит свои файлы в очередь позже обычного `wp_enqueue_scripts`,
// поэтому снимаем в несколько заходов: перед печатью в head и перед печатью подвала.
add_action( 'wp_enqueue_scripts', 'rentos_ad_dequeue', 9999 );
add_action( 'wp_print_styles', 'rentos_ad_dequeue', 0 );
add_action( 'wp_print_scripts', 'rentos_ad_dequeue', 0 );
add_action( 'wp_print_footer_scripts', 'rentos_ad_dequeue', 0 );
