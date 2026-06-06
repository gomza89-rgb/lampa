(function () {
    'use strict';

    if (typeof AbortController === 'undefined') {
        window.AbortController = function () {
            this.signal = { aborted: false };
            this.abort = function () { this.signal.aborted = true; };
        };
    }

    var rutor_url = 'https://rutor.info';

    // Загрузка HTML через CORS-прокси
    function fetchHtml(url, callback, error_callback) {
        var proxyList = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];
        var currentProxy = 0;

        function tryFetch() {
            if (currentProxy >= proxyList.length) {
                if (error_callback) error_callback();
                return;
            }
            var fetchUrl = proxyList[currentProxy] + encodeURIComponent(url);
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 10000);

            fetch(fetchUrl, { signal: controller.signal })
                .then(function(r) {
                    clearTimeout(timeoutId);
                    if (!r.ok) throw new Error(r.status);
                    return r.text();
                })
                .then(function(text) {
                    if (text && text.length > 100) callback(text);
                    else throw new Error('Empty');
                })
                .catch(function() {
                    clearTimeout(timeoutId);
                    currentProxy++;
                    tryFetch();
                });
        }
        tryFetch();
    }

    // TMDB запрос через Lampa.Reguest (совместимо с tmdb-proxy)
    function tmdbGet(path, callback, errorCallback) {
        var network = new Lampa.Reguest();
        var url = Lampa.TMDB.api(path);
        network.timeout(8000);
        network.silent(url, function(data) {
            callback(data);
        }, function() {
            if (errorCallback) errorCallback();
        });
    }

    // Получить URL постера через Lampa (совместимо с tmdb-proxy)
    function posterUrl(poster_path) {
        if (!poster_path) return '';
        if (Lampa.TMDB.image) {
            return Lampa.TMDB.image('t/p/w500' + poster_path);
        }
        return 'https://image.tmdb.org/t/p/w500' + poster_path;
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

                search_title = search_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();
                original_title = original_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();

                results.push({
                    title: search_title || title_full,
                    original_title: original_title || search_title || title_full,
                    year: year,
                    release_date: year ? year + '-01-01' : '0000-00-00',
                    poster_path: '',
                    vote_average: 0,
                    id: 0, 
                    type: is_serial ? 'tv' : 'movie',
                    rutor_url: url
                });
            }
        });
        return results;
    }

    // Очередь TMDB-поиска
    var queue = [];
    var active = 0;
    var max_active = 2;

    function processQueue() {
        while (active < max_active && queue.length > 0) {
            active++;
            var job = queue.shift();
            searchTMDB(job.element, job.card, job.is_serial);
        }
    }

    function searchTMDB(elem, card, is_serial) {
        var type = is_serial ? 'tv' : 'movie';

        function done() {
            active--;
            setTimeout(processQueue, 300);
        }

        function apply(tmdb) {
            if (tmdb) {
                elem.id = tmdb.id;
                elem.poster_path = tmdb.poster_path;
                elem.vote_average = tmdb.vote_average || 0;
                if (tmdb.backdrop_path) elem.background_image = tmdb.backdrop_path;
                
                var img = posterUrl(tmdb.poster_path);
                if (img) {
                    var el = card.render().find('.card__img')[0];
                    if (el) {
                        el.onload = function() { card.render().addClass('card--loaded'); };
                        el.src = img;
                    }
                }
            }
            done();
        }

        // Стратегия: ищем по оригинальному названию (англ), потом по русскому, потом без года
        var queries = [];
        if (elem.original_title && elem.original_title !== elem.title) queries.push(elem.original_title);
        queries.push(elem.title);
        
        function trySearch(idx, with_year) {
            if (idx >= queries.length) {
                if (with_year) return trySearch(0, false); // повтор без года
                return apply(false);
            }
            var q = queries[idx];
            var path = 'search/' + type + '?query=' + encodeURIComponent(q) + '&language=ru';
            if (with_year && elem.year) path += '&year=' + elem.year;

            tmdbGet(path, function(data) {
                if (data && data.results && data.results.length > 0) {
                    apply(data.results[0]);
                } else {
                    trySearch(idx + 1, with_year);
                }
            }, function() {
                trySearch(idx + 1, with_year);
            });
        }

        trySearch(0, true);
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
                _this.empty('Не удалось загрузить данные.');
            });
        };

        comp.nextPageReuest = function (object, resolve, reject) {
            var rutor_page = (object.page || 1) - 1;
            var next_url = rutor_url + object.url + '/' + rutor_page;
            
            fetchHtml(next_url, function (html_str) {
                var results = parseHtml(html_str, is_serial);
                if (results.length === 0) resolve({ results: [], total_pages: object.page });
                else resolve({ results: results, total_pages: 50 });
            }, function() { reject(); });
        };

        comp.cardRender = function (object, element, card) {
            card.onEnter = function () {
                if (element.id) {
                    Lampa.Activity.push({
                        url: '',
                        title: element.title,
                        component: 'full',
                        id: element.id,
                        method: element.type,
                        card: element,
                        source: 'tmdb'
                    });
                } else {
                    Lampa.Noty.show('Карточка ещё загружается, подождите...');
                }
            };

            queue.push({ element: element, card: card, is_serial: is_serial });
            processQueue();
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
