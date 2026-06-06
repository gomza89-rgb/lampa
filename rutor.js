(function () {
    'use strict';

    var plugin_name = 'Rutor Подборки 6';
    var rutor_url = 'https://rutor.info'; // Базовый URL

    // Компонент для отображения подборки
    function RutorComponent(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({mask: true, over: true});
        var items = [];
        var html = $('<div></div>');
        var body = $('<div class="category-full"></div>');
        var info = Lampa.Template.get('info');
        
        var active_page = object.page || 1;
        var is_serial = object.url.indexOf('seriali') !== -1;
        var is_loading = false;
        var has_more = true;

        function fetchHtml(url, callback, error_callback) {
            var req = new Lampa.Reguest();
            var methods = [
                function(next) { req.silent(url, function(html) { callback(html); }, next, false, {dataType: 'text', timeout: 5000}); },
                function(next) { 
                    var proxy = 'https://api.allorigins.win/get?url=' + encodeURIComponent(url);
                    req.silent(proxy, function(json) { if (json && json.contents) callback(json.contents); else next(); }, next, false, {timeout: 8000});
                },
                function(next) { 
                    var proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
                    req.silent(proxy, function(html) { callback(html); }, next, false, {dataType: 'text', timeout: 8000});
                }
            ];
            var step = 0;
            function tryNext() { if (step < methods.length) { methods[step++](tryNext); } else { if (error_callback) error_callback(); } }
            tryNext();
        }

        function parseHtml(html_str) {
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
                        title_full: title_full,
                        search_title: search_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim(),
                        original_title: original_title.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim(),
                        year: year,
                        url: url
                    });
                }
            });
            return results;
        }

        this.create = function () {
            this.activity.loader(true);
            var rutor_page = active_page - 1;
            var active_url = rutor_url + object.url + (rutor_page > 0 ? '/' + rutor_page : '');

            fetchHtml(active_url, function (html_str) {
                if (html_str) {
                    var results = parseHtml(html_str);
                    if (results.length === 0) {
                        this.empty('Торренты не найдены. Возможно, изменился дизайн сайта или это заглушка провайдера.');
                        return;
                    }
                    this.build(results, false);
                } else {
                    this.empty('Сервер вернул пустой ответ (без данных)');
                }
            }.bind(this), function () {
                this.empty('Сетевая ошибка: Не удалось загрузить данные (CORS или провайдер блокирует доступ).');
            }.bind(this));

            return this.render();
        };

        this.append = function () {
            if (is_loading || !has_more) return;
            is_loading = true;
            active_page++;
            var next_rutor_page = active_page - 1;
            var next_url = rutor_url + object.url + '/' + next_rutor_page;
            
            fetchHtml(next_url, function (html_str) {
                var results = parseHtml(html_str);
                if (results.length === 0) {
                    has_more = false;
                } else {
                    this.build(results, true);
                }
                is_loading = false;
            }.bind(this), function() { 
                is_loading = false; 
                has_more = false; 
            });
        };

        this.empty = function (msg) {
            var empty = new Lampa.Empty({title: 'Ошибка', descr: msg});
            html.append(empty.render());
            this.activity.loader(false);
            this.activity.toggle();
        };

        this.build = function (results, is_append) {
            if (!is_append) {
                this.activity.loader(false);
                this.activity.toggle();
                info.find('.info__rate, .info__right').remove();
                html.append(info);
                html.append(scroll.render());
                scroll.append(body);
                
                scroll.onEnd = function () {
                    this.append();
                }.bind(this);
            }

            var new_items = [];

            results.forEach(function(res) {
                var item = {
                    title: res.search_title || res.title_full,
                    original_title: res.original_title || res.search_title,
                    release_date: res.year ? res.year + '-01-01' : '0000-00-00',
                    poster_path: '',
                    background_image: '',
                    vote_average: 0,
                    id: 0, 
                    type: is_serial ? 'tv' : 'movie'
                };
                
                var card = new Lampa.Card(item, { card_category: true });
                card.create();
                body.append(card.render());
                
                var item_obj = { card: card, data: res, item: item };
                items.push(item_obj);
                new_items.push(item_obj);
                
                card.onHover = function () {
                    info.find('.info__title').text(item.original_title || item.title);
                    info.find('.info__title-original').text(item.title);
                };
                
                card.onEnter = function () {
                    if (item.id) {
                        Lampa.Activity.push({
                            url: '',
                            title: item.title,
                            component: 'full',
                            id: item.id,
                            method: item.type,
                            card: item
                        });
                    } else {
                        Lampa.Noty.show('Поиск карточки фильма в базе, подождите пару секунд...');
                        // Попробуем поискать вручную если еще не найдено
                        Lampa.TMDB.api('search/' + item.type, { query: item.original_title || item.title, year: item.release_date.split('-')[0] }, function(result) {
                            if (result && result.results && result.results.length > 0) {
                                var tmdb_item = result.results[0];
                                item.id = tmdb_item.id;
                                Lampa.Activity.push({ url: '', title: item.title, component: 'full', id: item.id, method: item.type, card: item });
                            } else {
                                Lampa.Noty.show('Фильм не найден в базе TMDB.');
                            }
                        });
                    }
                };
            });
            
            // Если это добавление страницы, обновим навигацию Lampa
            if (is_append) {
                Lampa.Controller.collectionAppend(new_items.map(function(i) { return i.card.render()[0]; }));
            }

            // Последовательная загрузка данных с TMDB только для новых элементов
            var queue = new_items.slice();
            function loadNext() {
                if (queue.length === 0) return;
                var current = queue.shift();
                
                var query_orig = current.data.original_title;
                var query_rus = current.data.search_title;
                var year = current.data.year;
                var type = is_serial ? 'tv' : 'movie';
                
                function applyTMDB(tmdb_item) {
                    if (tmdb_item) {
                        current.item.id = tmdb_item.id;
                        current.item.poster_path = tmdb_item.poster_path;
                        current.item.vote_average = tmdb_item.vote_average;
                        
                        if (tmdb_item.poster_path) {
                            var img_url = 'https://image.tmdb.org/t/p/w500' + tmdb_item.poster_path;
                            current.card.render().find('.card__img').attr('src', img_url);
                        }
                    }
                    setTimeout(loadNext, 100); // 100ms задержка, TMDB API держит 40 req/sec
                }

                function searchTMDBText() {
                    var searchApi = function(query, callback) {
                        if (!query || query.length < 2) return callback(false);
                        Lampa.TMDB.api('search/' + type, { query: query, year: year }, function(result) {
                            if (result && result.results && result.results.length > 0) callback(result.results[0]);
                            else callback(false);
                        }, function() { callback(false); });
                    };

                    searchApi(query_orig, function(res_orig) {
                        if (res_orig) applyTMDB(res_orig);
                        else searchApi(query_rus, function(res_rus) { applyTMDB(res_rus); });
                    });
                }
                
                searchTMDBText();
            }
            
            loadNext();
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(items.length ? items[0].card.render()[0] : false, scroll.render());
                },
                left: function () {
                    if (Lampa.Navigator.canmove('left')) Lampa.Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    Lampa.Navigator.move('right');
                },
                up: function () {
                    if (Lampa.Navigator.canmove('up')) Lampa.Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Lampa.Navigator.canmove('down')) Lampa.Navigator.move('down');
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            network.clear();
            scroll.destroy();
            if (info) info.remove();
            html.remove();
            items.forEach(function(i) { i.card.destroy(); });
            items = [];
        };
    }

    Lampa.Component.add('rutor_collection', RutorComponent);

    // Добавление в меню
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
                onBack: function () {
                    Lampa.Controller.toggle('menu');
                }
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
