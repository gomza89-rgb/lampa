(function () {
    'use strict';

    if (typeof AbortController === 'undefined') {
        window.AbortController = function () {
            this.signal = { aborted: false };
            this.abort = function () { this.signal.aborted = true; };
        };
    }

    var rutor_url = 'https://rutor.info';

    // Загрузка HTML страницы через прокси (для rutor.info)
    function fetchHtml(url, callback, error_callback) {
        var proxyList = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://cors-anywhere.herokuapp.com/'
        ];
        var currentProxy = 0;

        function tryFetch() {
            if (currentProxy >= proxyList.length) {
                if (error_callback) error_callback();
                return;
            }
            var proxy = proxyList[currentProxy];
            var fetchUrl = proxy + encodeURIComponent(url);

            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 10000);

            fetch(fetchUrl, { signal: controller.signal })
                .then(function(response) {
                    clearTimeout(timeoutId);
                    if (!response.ok) throw new Error('Bad response ' + response.status);
                    return response.text();
                })
                .then(function(text) {
                    if (text && text.length > 100) callback(text);
                    else throw new Error('Empty body');
                })
                .catch(function(e) {
                    clearTimeout(timeoutId);
                    currentProxy++;
                    tryFetch();
                });
        }
        tryFetch();
    }

    // Запрос к TMDB через встроенный механизм Lampa (совместимо с tmdb-proxy плагином)
    function tmdbRequest(path, params, callback, errorCallback) {
        var network = new Lampa.Reguest();
        // Собираем query string из params
        var query_parts = [];
        if (params) {
            for (var key in params) {
                if (params.hasOwnProperty(key)) {
                    query_parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
                }
            }
        }
        var full_path = path + (query_parts.length ? (path.indexOf('?') > -1 ? '&' : '?') + query_parts.join('&') : '');
        // Lampa.TMDB.api() возвращает полный URL (с прокси если включен)
        var url = Lampa.TMDB.api(full_path);
        
        network.timeout(8000);
        network.silent(url, function(data) {
            if (callback) callback(data);
        }, function(a, c) {
            if (errorCallback) errorCallback(a, c);
        });
    }

    function parseHtml(html_str, is_serial) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html_str, 'text/html');
        var rows = doc.querySelectorAll('#index tr');
        var results = [];
        
        rows.forEach(function(row) {
            var a = row.querySelector('a[href^="/torrent/"]');
            if (a && a.textContent) {
                var title_full = a.textContent.trim();
                var url = a.getAttribute('href');
                
                var search_title = title_full;
                var year = '';
                
                var match_year = title_full.match(/\((\d{4})\)/);
                if (match_year) {
                    year = match_year[1];
                    search_title = title_full.substring(0, title_full.indexOf(match_year[0])).trim();
                }
                
                var original_title = '';
                if (search_title.indexOf('/') !== -1) {
                    var parts = search_title.split('/');
                    search_title = parts[0].trim(); 
                    original_title = parts.length > 1 ? parts[1].trim() : '';
                }

                // Простая очистка от мусора
                search_title = search_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();
                original_title = original_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();

                results.push({
                    title: search_title || title_full,
                    original_title: original_title || search_title || title_full,
                    search_title: search_title,
                    year: year,
                    release_date: year ? year + '-01-01' : '0000-00-00',
                    poster_path: '',
                    background_image: '',
                    vote_average: 0,
                    id: 0, 
                    type: is_serial ? 'tv' : 'movie',
                    rutor_page_url: rutor_url + url,
                    title_full: title_full
                });
            }
        });
        return results;
    }

    // Очередь для фоновой загрузки данных из TMDB
    var rutor_queue = [];
    var rutor_active_threads = 0;
    var rutor_max_threads = 2;

    function processRutorQueue() {
        while (rutor_active_threads < rutor_max_threads && rutor_queue.length > 0) {
            rutor_active_threads++;
            loadNextTMDB();
        }
    }

    function loadNextTMDB() {
        var current = rutor_queue.shift();
        if (!current) {
            rutor_active_threads--;
            return;
        }

        var elem = current.element;
        var card = current.card;
        
        function done() {
            rutor_active_threads--;
            setTimeout(processRutorQueue, 300);
        }

        function applyTMDB(tmdb_item) {
            if (tmdb_item) {
                elem.id = tmdb_item.id;
                elem.poster_path = tmdb_item.poster_path;
                elem.vote_average = tmdb_item.vote_average;
                if (tmdb_item.backdrop_path) {
                    elem.background_image = tmdb_item.backdrop_path;
                }
                
                if (tmdb_item.poster_path) {
                    // Используем Lampa.TMDB.image() для правильного URL постера (через прокси)
                    var img_url = Lampa.TMDB.image('t/p/w500' + tmdb_item.poster_path);
                    var card_render = card.render();
                    if (card_render) {
                        var card_img = card_render.find('.card__img')[0];
                        if (card_img) {
                            card_img.onload = function() {
                                card_render.addClass('card--loaded');
                            };
                            card_img.src = img_url;
                        }
                    }
                }
            }
            done();
        }

        // Загружаем страницу релиза rutor чтобы найти IMDB ID
        fetchHtml(elem.rutor_page_url, function(html_str) {
            var imdb_match = html_str.match(/imdb\.com\/title\/(tt\d+)/i);
            if (imdb_match) {
                var imdb_id = imdb_match[1];
                tmdbRequest('find/' + imdb_id + '?external_source=imdb_id', {}, function(find_res) {
                    var type_res = elem.type === 'tv' ? find_res.tv_results : find_res.movie_results;
                    if (type_res && type_res.length > 0) applyTMDB(type_res[0]);
                    else applyTMDB(false);
                }, function() { applyTMDB(false); });
            } else {
                applyTMDB(false);
            }
        }, function() {
            applyTMDB(false);
        });
    }

    function RutorComponent(object) {
        var comp = new Lampa.InteractionCategory(object);
        var is_serial = object.url.indexOf('seriali') !== -1;

        comp.create = function () {
            var _this = this;
            var rutor_page = (object.page || 1) - 1;
            var active_url = rutor_url + object.url + (rutor_page > 0 ? '/' + rutor_page : '');

            fetchHtml(active_url, function (html_str) {
                var results = parseHtml(html_str, is_serial);
                if (results.length === 0) {
                    _this.empty('Торренты не найдены.');
                    return;
                }
                _this.build({
                    results: results,
                    total_pages: 50
                });
            }, function () {
                _this.empty('Не удалось загрузить данные. Все прокси недоступны.');
            });
        };

        comp.nextPageReuest = function (object, resolve, reject) {
            var rutor_page = (object.page || 1) - 1;
            var next_url = rutor_url + object.url + '/' + rutor_page;
            
            fetchHtml(next_url, function (html_str) {
                var results = parseHtml(html_str, is_serial);
                if (results.length === 0) {
                    resolve({ results: [], total_pages: object.page });
                } else {
                    resolve({ results: results, total_pages: 50 });
                }
            }, function() { 
                reject();
            });
        };

        comp.cardRender = function (object, element, card) {
            card.onEnter = function () {
                if (element.id) {
                    Lampa.Activity.push({ url: '', title: element.title, component: 'full', id: element.id, method: element.type, card: element, source: 'tmdb' });
                } else {
                    Lampa.Noty.show('Карточка ещё загружается, подождите...');
                }
            };

            rutor_queue.push({
                element: element,
                card: card
            });
            processRutorQueue();
        };

        return comp;
    }

    Lampa.Component.add('rutor_collection', RutorComponent);

    function addMenu() {
        var svg = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z" /></svg>';
        var menu_item = $('<li class="menu__item selector" data-action="rutor"><div class="menu__ico">' + svg + '</div><div class="menu__text">Rutor</div></li>');
        
        menu_item.on('hover:enter', function () {
            Lampa.Select.show({
                title: 'Rutor Подборки',
                items: [
                    { title: 'Новые фильмы', url: '/kino' },
                    { title: 'Зарубежные сериалы', url: '/seriali' }
                ],
                onSelect: function (a) {
                    Lampa.Activity.push({
                        url: a.url,
                        title: a.title,
                        component: 'rutor_collection',
                        page: 1
                    });
                },
                onBack: function () { Lampa.Controller.toggle('menu'); }
            });
        });

        $('.menu .menu__item[data-action="settings"]').before(menu_item);
    }

    if (window.appready) addMenu();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') addMenu();
        });
    }

})();
