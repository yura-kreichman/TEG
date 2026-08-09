<?php
/**
 * Plugin Name: RentOS — язык экрана входа FluentAuth
 * Description: Тексты кастомайзера FluentAuth (баннер, заголовок формы, кнопка, описание) хранятся
 *              в базе одной строкой и в самом плагине заданы без __(), поэтому за языком не следуют.
 *              Здесь они подменяются по текущей локали через штатный core-фильтр опции.
 *              В админке фильтр не работает — чтобы настройки плагина оставались редактируемыми.
 */

add_filter('option___fls_auth_customizer_settings', function ($settings) {
    if (is_admin() || !is_array($settings)) {
        return $settings;
    }

    $site = get_bloginfo('name');
    $locale = determine_locale();

    $lang = 'en';
    foreach (['ru' => 'ru', 'uk' => 'uk', 'it' => 'it', 'ro' => 'ro'] as $prefix => $code) {
        if (str_starts_with($locale, $prefix)) { $lang = $code; break; }
    }

    $dict = [
        'ru' => [
            'welcome' => 'Добро пожаловать в ',
            'login'   => ['title' => 'Вход в ',          'button' => 'Войти',             'desc' => 'Введите данные для входа'],
            'signup'  => ['title' => 'Регистрация в ',   'button' => 'Зарегистрироваться','desc' => 'Заполните данные для регистрации'],
        ],
        'uk' => [
            'welcome' => 'Ласкаво просимо до ',
            'login'   => ['title' => 'Вхід до ',         'button' => 'Увійти',            'desc' => 'Введіть дані для входу'],
            'signup'  => ['title' => 'Реєстрація в ',    'button' => 'Зареєструватися',   'desc' => 'Заповніть дані для реєстрації'],
        ],
        'it' => [
            'welcome' => 'Benvenuto in ',
            'login'   => ['title' => 'Accedi a ',        'button' => 'Accedi',            'desc' => 'Inserisci i tuoi dati per accedere'],
            'signup'  => ['title' => 'Registrati a ',    'button' => 'Registrati',        'desc' => 'Inserisci i tuoi dati per registrarti'],
        ],
        'ro' => [
            'welcome' => 'Bine ați venit la ',
            'login'   => ['title' => 'Autentificare în ','button' => 'Autentificare',     'desc' => 'Introduceți datele pentru autentificare'],
            'signup'  => ['title' => 'Înregistrare în ', 'button' => 'Înregistrare',      'desc' => 'Completați datele pentru înregistrare'],
        ],
        'en' => [
            'welcome' => 'Welcome to ',
            'login'   => ['title' => 'Login to ',        'button' => 'Log In',            'desc' => 'Please enter your details to login'],
            'signup'  => ['title' => 'Sign Up to ',      'button' => 'Sign up',           'desc' => 'Please enter your details to register'],
        ],
    ];

    $t = $dict[$lang];

    foreach (['login', 'signup'] as $section) {
        if (isset($settings[$section]['banner']['title']))      $settings[$section]['banner']['title']      = $t['welcome'] . $site;
        if (isset($settings[$section]['form']['title']))        $settings[$section]['form']['title']        = $t[$section]['title'] . $site;
        if (isset($settings[$section]['form']['button_label'])) $settings[$section]['form']['button_label'] = $t[$section]['button'];
        if (isset($settings[$section]['form']['description']))  $settings[$section]['form']['description']  = $t[$section]['desc'];
    }

    return $settings;
});
