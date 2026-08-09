<?php
/**
 * Plugin Name: SEO Schema Language Fix (site-specific)
 * Description: Yoast's JSON-LD schema graph is built from the untranslated
 * (Russian) permalink/title before TranslatePress's output-buffer rewrite
 * runs, and TranslatePress never rewrites text inside <script> tags anyway.
 * This corrects @id/url/headline/breadcrumb fields for translated pages using
 * TranslatePress's own url_converter API and its string dictionary tables.
 * Not a core file, not overwritten by WordPress updates.
 */

function rentos_current_lang_slug() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : '/';
	if ( preg_match( '#^/(en|ua|it|ro)(/|$)#', $uri, $m ) ) {
		return $m[1];
	}
	return 'ru';
}

function rentos_lang_maps( $slug ) {
	$map = array(
		'en' => array( 'trp' => 'en_US', 'dict' => 'en_us' ),
		'ua' => array( 'trp' => 'uk', 'dict' => 'uk' ),
		'it' => array( 'trp' => 'it_IT', 'dict' => 'it_it' ),
		'ro' => array( 'trp' => 'ro_RO', 'dict' => 'ro_ro' ),
	);
	return isset( $map[ $slug ] ) ? $map[ $slug ] : null;
}

function rentos_schema_localized_url( $original_url ) {
	if ( empty( $original_url ) ) {
		return $original_url;
	}
	$slug = rentos_current_lang_slug();
	if ( 'ru' === $slug || ! class_exists( 'TRP_Translate_Press' ) ) {
		return $original_url;
	}
	$langs = rentos_lang_maps( $slug );
	if ( ! $langs ) {
		return $original_url;
	}
	$trp           = TRP_Translate_Press::get_trp_instance();
	$url_converter = $trp->get_component( 'url_converter' );
	if ( ! is_object( $url_converter ) ) {
		return $original_url;
	}
	$translated = $url_converter->get_url_for_language( $langs['trp'], $original_url, '' );
	return $translated ? $translated : $original_url;
}

function rentos_schema_localized_text( $original_text ) {
	if ( empty( $original_text ) ) {
		return $original_text;
	}
	$slug = rentos_current_lang_slug();

	if ( 'Home' === $original_text ) {
		$home_map = array(
			'ru' => 'Главная',
			'en' => 'Home',
			'ua' => 'Головна',
			'it' => 'Home',
			'ro' => 'Acasă',
		);
		return isset( $home_map[ $slug ] ) ? $home_map[ $slug ] : $original_text;
	}

	if ( 'ru' === $slug ) {
		return $original_text;
	}
	$langs = rentos_lang_maps( $slug );
	if ( ! $langs ) {
		return $original_text;
	}

	global $wpdb;
	$dict_table  = $wpdb->prefix . 'trp_dictionary_ru_ru_' . $langs['dict'];
	$orig_table  = $wpdb->prefix . 'trp_original_strings';
	$original_id = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$orig_table} WHERE original = %s LIMIT 1", $original_text ) );
	if ( $original_id ) {
		$translated = $wpdb->get_var( $wpdb->prepare( "SELECT translated FROM `{$dict_table}` WHERE original_id = %d AND status = 2 LIMIT 1", $original_id ) );
		if ( $translated ) {
			return $translated;
		}
	}

	return $original_text;
}

function rentos_is_term_archive() {
	return is_category() || is_tag() || ( function_exists( 'is_tax' ) && is_tax() );
}

function rentos_localized_queried_term_name() {
	$term = get_queried_object();
	if ( ! is_object( $term ) || empty( $term->name ) ) {
		return '';
	}
	$translated = rentos_schema_localized_text( $term->name );
	return ( $translated && $translated !== $term->name ) ? $translated : '';
}

add_filter(
	'wpseo_schema_webpage',
	function ( $data ) {
		if ( empty( $data['url'] ) ) {
			return $data;
		}
		$localized      = rtrim( rentos_schema_localized_url( $data['url'] ), '/' ) . '/';
		$data['@id']    = $localized;
		$data['url']    = $localized;
		if ( ! empty( $data['breadcrumb']['@id'] ) ) {
			$data['breadcrumb']['@id'] = $localized . '#breadcrumb';
		}
		if ( ! empty( $data['potentialAction'][0]['target'] ) ) {
			$data['potentialAction'][0]['target'] = array( $localized );
		}
		if ( rentos_is_term_archive() && ! empty( $data['name'] ) ) {
			$term = get_queried_object();
			$translated_name = rentos_localized_queried_term_name();
			if ( $translated_name && is_object( $term ) ) {
				$data['name'] = str_replace( $term->name, $translated_name, $data['name'] );
			}
		}
		return $data;
	},
	20
);

add_filter(
	'wpseo_title',
	function ( $title ) {
		if ( rentos_is_term_archive() ) {
			$term = get_queried_object();
			$translated_name = rentos_localized_queried_term_name();
			if ( $translated_name && is_object( $term ) ) {
				$title = str_replace( $term->name, $translated_name, $title );
			}
		}
		return $title;
	},
	20
);

add_filter(
	'wpseo_schema_article',
	function ( $data ) {
		if ( ! empty( $data['isPartOf']['@id'] ) ) {
			$localized = rtrim( rentos_schema_localized_url( $data['isPartOf']['@id'] ), '/' ) . '/';
			$data['@id']              = $localized . '#article';
			$data['isPartOf']['@id']  = $localized;
			if ( ! empty( $data['mainEntityOfPage']['@id'] ) ) {
				$data['mainEntityOfPage']['@id'] = $localized;
			}
		}
		if ( ! empty( $data['headline'] ) ) {
			$data['headline'] = rentos_schema_localized_text( $data['headline'] );
		}
		return $data;
	},
	20
);

add_filter(
	'wpseo_schema_breadcrumb',
	function ( $data ) {
		if ( ! empty( $data['itemListElement'] ) ) {
			foreach ( $data['itemListElement'] as $i => $item ) {
				if ( ! empty( $item['name'] ) ) {
					$data['itemListElement'][ $i ]['name'] = rentos_schema_localized_text( $item['name'] );
				}
				if ( ! empty( $item['item'] ) ) {
					$data['itemListElement'][ $i ]['item'] = rentos_schema_localized_url( $item['item'] );
				}
			}
		}
		if ( ! empty( $data['@id'] ) ) {
			global $post;
			$original_url = '';
			if ( is_object( $post ) ) {
				$original_url = get_permalink( $post );
			} elseif ( function_exists( 'is_front_page' ) && is_front_page() ) {
				$original_url = home_url( '/' );
			}
			if ( $original_url ) {
				$localized   = rtrim( rentos_schema_localized_url( $original_url ), '/' ) . '/';
				$data['@id'] = $localized . '#breadcrumb';
			}
		}
		return $data;
	},
	20
);
