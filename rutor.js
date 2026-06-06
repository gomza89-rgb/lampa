(function () {
    'use strict';

    if (typeof AbortController === 'undefined') {
        window.AbortController = function () {
            this.signal = { aborted: false };
            this.abort = function () { this.signal.aborted = true; };
        };
    }

    var rutor_url = 'https://rutor.info';

    function fetchHtml(url, callback, error_callback) {
        var proxyList = [
            '', 
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];
        var currentProxy = 0;

        function tryFetch() {
            if (currentProxy >= proxyList.length) {
                if (error_callback) error_callback();
                return;
            }
            var proxy = proxyList[currentProxy];
            var fetchUrl = proxy ? proxy + encodeURIComponent(url) : url;

            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 8000);

            fetch(fetchUrl, { signal: controller.signal })
                .then(function(response) {
                    clearTimeout(timeoutId);
                    if (!response.ok) throw new Error('Bad response');
                    return response.text();
                })
                .then(function(text) {
                    if (text && text.length > 50) callback(text);
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

                results.push({
                    title: search_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim(),
                    original_title: original_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim() || title_full,
                    search_title: search_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim(),
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

    var rutor_queue = [];
    var rutor_active_threads = 0;
    var rutor_max_threads = 1; // Уменьшим до 1 потока, чтобы избежать бана от TMDB (ограничение 40 запросов в 10 сек)

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
            setTimeout(processRutorQueue, 400); // 400ms задержка = 2.5 запроса в секунду (безопасно для TMDB)
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
                    var img_url = 'https://image.tmdb.org/t/p/w500' + tmdb_item.poster_path;
                    var card_img = card.render().find('.card__img')[0];
                    if (card_img) {
                        card_img.onload = function() {
                            card.render().addClass('card--loaded');
                        };
                        card_img.src = img_url;
                    }
                }
            }
            done();
        }

        function searchTMDBText() {
            // Сначала пробуем искать по оригинальному названию, если нет - по русскому
            var queries = [];
            if (elem.original_title) queries.push(elem.original_title);
            if (elem.search_title && elem.search_title !== elem.original_title) queries.push(elem.search_title);
            if (queries.length === 0) return applyTMDB(false);

            function tryQuery(index) {
                if (index >= queries.length) return applyTMDB(false);
                var q = queries[index];
                
                Lampa.TMDB.api('search/' + elem.type, { query: q, year: elem.year }, function(result) {
                    if (result && result.results && result.results.length > 0) applyTMDB(result.results[0]);
                    else tryQuery(index + 1);
                }, function() { tryQuery(index + 1); });
            }
            
            tryQuery(0);
        }

        fetchHtml(elem.rutor_page_url, function(html_str) {
            var imdb_match = html_str.match(/imdb\.com\/title\/(tt\d+)/i);
            if (imdb_match) {
                var imdb_id = imdb_match[1];
                Lampa.TMDB.api('find/' + imdb_id + '?external_source=imdb_id', {}, function(find_res) {
                    var type_res = elem.type === 'tv' ? find_res.tv_results : find_res.movie_results;
                    if (type_res && type_res.length > 0) applyTMDB(type_res[0]);
                    else searchTMDBText();
                }, function() { searchTMDBText(); });
            } else {
                searchTMDBText();
            }
        }, function() {
            searchTMDBText();
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
                    _this.empty('Торренты не найдены. Возможно, сайт временно недоступен или изменил дизайн.');
                    return;
                }
                _this.build({
                    results: results,
                    total_pages: 100
                });
            }, function () {
                _this.empty('Сетевая ошибка: Не удалось загрузить данные (провайдер блокирует доступ).');
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
                    resolve({ results: results, total_pages: 100 });
                }
            }, function() { 
                reject();
            });
        };

        comp.cardRender = function (object, element, card) {
            card.onEnter = function () {
                if (element.id) {
                    Lampa.Activity.push({ url: '', title: element.title, component: 'full', id: element.id, method: element.type, card: element });
                } else {
                    Lampa.Noty.show('Поиск карточки фильма в базе, подождите пару секунд...');
                    var q = element.original_title || element.search_title;
                    Lampa.TMDB.api('search/' + element.type, { query: q, year: element.year }, function(result) {
                        if (result && result.results && result.results.length > 0) {
                            element.id = result.results[0].id;
                            Lampa.Activity.push({ url: '', title: element.title, component: 'full', id: element.id, method: element.type, card: element });
                        } else {
                            Lampa.Noty.show('Фильм не найден в базе TMDB.');
                        }
                    });
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
