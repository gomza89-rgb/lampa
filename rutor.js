(function () {
    'use strict';

    var plugin_name = 'Rutor Подборки';
    var rutor_url = 'https://rutor.info'; // Базовый URL, можно будет вынести в настройки

    // Компонент для отображения подборки
    function RutorComponent(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({mask: true, over: true});
        var items = [];
        var html = $('<div></div>');
        var body = $('<div class="category-full"></div>');
        var info = Lampa.Template.get('info');
        
        var active_url = rutor_url + object.url;
        var is_serial = object.url.indexOf('seriali') !== -1;

        this.create = function () {
            this.activity.loader(true);

            // Делаем прямой запрос. Для работы в браузере нужен плагин Allow CORS!
            // Делаем прямой запрос. Для работы в браузере нужен плагин Allow CORS!
            network.silent(active_url, function (html_str) {
                if (html_str) {
                    var parser = new DOMParser();
                    var doc = parser.parseFromString(html_str, 'text/html');
                    var rows = doc.querySelectorAll('#index tr');
                    
                    if (rows.length === 0) {
                        this.empty('Сайт загрузился, но торренты не найдены. Размер ответа: ' + html_str.length + ' байт. Возможно, это заглушка провайдера.');
                        return;
                    }

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

                    if (results.length === 0) {
                        this.empty('Найдено ' + rows.length + ' строк, но не удалось извлечь названия торрентов.');
                        return;
                    }

                    this.build(results);
                } else {
                    this.empty('Сервер вернул пустой ответ (без данных)');
                }
            }.bind(this), function (a, c) {
                this.empty('Сетевая ошибка: ' + network.errorDecode(a, c) + ' | Код: ' + (a && a.status ? a.status : 'нет'));
            }.bind(this), false, { dataType: 'text', timeout: 20000 });

            return this.render();
        };

        this.empty = function (msg) {
            var empty = new Lampa.Empty({title: 'Ошибка', descr: msg});
            html.append(empty.render());
            this.activity.loader(false);
            this.activity.toggle();
        };

        this.build = function (results) {
            this.activity.loader(false);
            this.activity.toggle();
            
            // Скрываем лишние элементы info блока
            info.find('.info__rate, .info__right').remove();
            
            html.append(info);
            html.append(scroll.render());
            scroll.append(body);

            var _this = this;

            results.forEach(function(res) {
                // Создаем болванку для фильма
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
                
                var card = new Lampa.Card(item, {
                    card_category: true
                });
                
                card.create();
                body.append(card.render());
                items.push({ card: card, data: res, item: item });
                
                card.onHover = function (target) {
                    info.find('.info__title').text(item.original_title || item.title);
                    info.find('.info__title-original').text(item.title); // Показываем полное название раздачи в качестве оригинального
                };
                
                card.onEnter = function (target, card_data) {
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
                        Lampa.Noty.show('Ищем точный ID на странице Rutor...');
                        network.silent(rutor_url + res.url, function (html_str) {
                            var imdb_match = html_str.match(/imdb\.com\/title\/(tt\d+)/i);
                            if (imdb_match) {
                                var imdb_id = imdb_match[1];
                                Lampa.TMDB.api('find/' + imdb_id + '?external_source=imdb_id', {}, function(find_res) {
                                    var type_res = item.type === 'tv' ? find_res.tv_results : find_res.movie_results;
                                    if (type_res && type_res.length > 0) {
                                        var tmdb_item = type_res[0];
                                        item.id = tmdb_item.id;
                                        Lampa.Activity.push({ url: '', title: item.title, component: 'full', id: item.id, method: item.type, card: item });
                                    } else {
                                        Lampa.Noty.show('IMDB ID найден (' + imdb_id + '), но в базе TMDB его нет.');
                                    }
                                }, function() { Lampa.Noty.show('Ошибка поиска в базе по IMDB ID'); });
                            } else {
                                Lampa.Noty.show('Не найдена ссылка на IMDB на странице раздачи.');
                            }
                        }, function() {
                            Lampa.Noty.show('Не удалось загрузить страницу раздачи.');
                        }, false, { dataType: 'text' });
                    }
                };
            });
            
            // Последовательная загрузка данных с TMDB
            var queue = items.slice();
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
                            var img_url = Lampa.TMDB.image('t/p/w500' + tmdb_item.poster_path);
                            current.card.render().find('.card__img').attr('src', img_url);
                        }
                    }
                    setTimeout(loadNext, 300);
                }

                function searchTMDB(query, callback) {
                    if (!query || query.length < 2) return callback(false);
                    Lampa.TMDB.api('search/' + type, { query: query, year: year }, function(result) {
                        if (result && result.results && result.results.length > 0) callback(result.results[0]);
                        else callback(false);
                    }, function() { callback(false); });
                }

                // Сначала ищем по английскому названию (оно точнее), если его нет - по русскому
                searchTMDB(query_orig, function(res_orig) {
                    if (res_orig) {
                        applyTMDB(res_orig);
                    } else {
                        searchTMDB(query_rus, function(res_rus) {
                            applyTMDB(res_rus);
                        });
                    }
                });
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
        // SVG иконка Rutor (взята иконка базы данных)
        var svg = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z" /></svg>';
        
        var menu_item = $('<li class="menu__item selector" data-action="rutor"><div class="menu__ico">' + svg + '</div><div class="menu__text">Rutor</div></li>');
        
        menu_item.on('hover:enter', function () {
            Lampa.Select.show({
                title: 'Rutor Подборки',
                items: [
                    {
                        title: 'Новые фильмы',
                        url: '/kino'
                    },
                    {
                        title: 'Зарубежные сериалы',
                        url: '/seriali'
                    }
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

        // Вставляем перед настройками
        $('.menu .menu__item[data-action="settings"]').before(menu_item);
    }

    if (window.appready) addMenu();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') addMenu();
        });
    }

})();
