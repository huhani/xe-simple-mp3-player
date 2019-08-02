(function($){

    var EventDispatcher = function() {
        var ID = 0;
        function EventDispatcher(){
            this._listeners = [];
        }

        EventDispatcher.prototype.getListeners = function() {
            this._listeners = this._listeners.filter(function(subscriber){
                return !subscriber.dead;
            }).sort(function(a, b) {
                return a.priority - b.priority;
            });
            return this._listeners;
        };

        EventDispatcher.prototype.subscribe = function(callback, priority) {
            if(priority === void 0) {
                priority = 20;
            }
            var subscriber = {
                id: ID++,
                handler: callback,
                priority: priority,
                dead: false
            };
            var that = this;
            var removed = false;
            this._listeners.push(subscriber);
            return {
                remove: function() {
                    if(!subscriber.dead) {
                        var idx = that._listeners.indexOf(subscriber);
                        if(idx > -1) {
                            that._listeners.splice(idx, 1);
                        }
                        subscriber.dead = true;
                    }
                }
            };
        };

        EventDispatcher.prototype.dispatch = function(payload) {
            var that = this;
            this.getListeners().forEach(function(listener){
                that._handleCallback(listener.handler, payload);
            });
        };

        EventDispatcher.prototype._handleCallback = function(handler, payload) {
            try {
                handler(payload);
            } catch(error) {
                window.setTimeout(function(){
                    throw error;
                }, 0);
            }
        };

        return EventDispatcher;
    }();

    var makeDeferred = function() {
        var __resolve = null;
        var __reject = null;
        var isResolved = false;
        var promise = new Promise(function(resolve, reject){
            __resolve = resolve;
            __reject = reject;
        });

        return {
            promise: promise,
            resolve: function(data) {
                if(!isResolved) {
                    __resolve(data);
                    isResolved = true;
                }
            },
            reject: function(data) {
                if(!isResolved) {
                    __reject(data);
                    isResolved = true;
                }
            },
            isResolved: function() {
                return isResolved;
            }
        };
    };

    var __extend = function() {
        var setProperty = Object.setPrototypeOf || {
                __proto__: []
            } instanceof Array && function(subClass, superClass) {
                subClass.__proto__ = superClass;
            }
            || function(subClass, superClass) {
                for (var key in superClass) {
                    superClass.hasOwnProperty(key) && (subClass[key] = superClass[key]);
                }
            };

        return function(subClass, superClass) {
            function fn() {
                this.constructor = subClass;
            }

            setProperty(subClass, superClass);
            if(superClass === null) {
                subClass.prototype = Object.create(superClass);
            } else {
                fn.prototype = superClass.prototype;
                subClass.prototype = new fn;
            }
        };
    }();

    var BluePlayer = function() {

        var PLAYER_ID = 0;
        var SEEK_TIME = 20000;
        var _MediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession || null;

        var TrackMode = function() {
            var mode = [];
            mode[mode.NONE = 0] = "NONE";
            mode[mode.REPEAT_LIST = 1] = "REPEAT_LIST";
            mode[mode.REPEAT_TRACK = 2] = "REPEAT_TRACK";
            mode[mode.CUSTOM_LIST = 3] = "CUSTOM_LIST";

            return mode;
        }();

        var TrackItem = function() {
            var ID = 0;

            function TrackItem(config, description) {
                this.id = ID++;
                this.title = config.title;
                this.artist = config.artist || null;
                this.album = config.album || null;
                this.albumArt = config.albumArt || null;
                this.duration = config.duration || null;
                this.url = config.url || null;
                this.type = config.type || null;
                this.lrcType = config.lrcType || null;
                this.lrc = config.lrc || null;
                this.allowRemove = config.allowRemove || false;
                this.description = description || null;
                if(!this.lrc) {
                    this.lrcType = null;
                }
            }

            return TrackItem;

        }();

        var UI = function() {

            function sliderStartHandler(event, ui) {
                var $this = $(this);
                if(!$this.hasClass('sliding')) {
                    $this.addClass('sliding');
                }
            }

            function sliderStopHandler(event, ui) {
                var $this = $(this);
                if($this.hasClass('sliding')) {
                    $this.removeClass('sliding');
                }
            }

            function trackListCSS(id, className, val) {
                return '<style id="BluePlayer__'+id+'" class="'+className+'">'+val+'</style>';
            }

            function isValidMode(mode){
                return !!(TrackMode[mode]);
            }

            function getExtendedLyricLyric(lyric, isNotice) {
                if(isNotice) {
                    return lyric.map(function(each) {
                        return '<span class="notice">'+each+'</span>';
                    }).join('');
                } else {
                    var lastPos = null;
                    return lyric.reduce(function(lyrics, currentLyric, idx) {
                        if(lastPos === null) {
                            lastPos = currentLyric[0];
                        }
                        if(lastPos !== currentLyric[0]) {
                            lastPos = currentLyric[0];
                            lyrics.push('<span class="blank"></span>');
                        }
                        lyrics.push('<span class="lrc" data-position="'+currentLyric[0]+'" data-index="'+idx+'">'+currentLyric[1]+'</span>');

                        return lyrics;
                    }, []).join('');
                }
            }

            function UI(container, player, config) {
                if(!container) {
                    throw new Error("Target must be exists;")
                }
                if(config === void 0) {
                    config = {};
                }

                var labels = config.labels;
                var messages = config.messages;
                var handlers = config.handlers;

                this._Player = player;
                this._currentTrackItem = null;

                //이 이벤트들은 모두 사용자 이벤트에 의해 발생.
                this.onPreviousButtonClick = new EventDispatcher;
                this.onNextButtonClick = new EventDispatcher;
                this.onPlayButtonClick = new EventDispatcher;
                this.onPauseButtonClick = new EventDispatcher;
                this.onTrackItemClick = new EventDispatcher;
                this.onModeButtonClick = new EventDispatcher;
                this.onRandomButtonClick = new EventDispatcher;
                this.onVolumeButtonClick = new EventDispatcher;
                this.onTrackRemoveClick = new EventDispatcher;
                this.onVolumeChange = new EventDispatcher;
                this.onPlaybackTimelineChange = new EventDispatcher;

                this._TrackListTemplates = [];
                this._ListClusterize = null;

                this._playLabel = labels.play || "Play";
                this._pauseLabel = labels.pause || "Pause";
                this._randomLabel = labels.random || "Random";
                this._repeatLabel = labels.repeat || "Repeat";
                this._skipForwardLabel = labels.skipForward || "Skip to next track";
                this._skipBackwardLabel = labels.skipBackward || "Skip to previous track";
                this._moreLabel = labels.more || "More";
                this._removeLabel = labels.remove || "Remove";
                this._closeLabel = labels.close || "Close";
                this._rightClickPlayLabel = labels.rightClickPlay ? labels.rightClickPlay : "Play";
                this._rightClickPauseLabel = labels.rightClickPause ? labels.rightClickPause : "Pause";
                this._rightClickRemoveTrackLabel = labels.rightClickRemoveTrack ? labels.rightClickRemoveTrack : "Remove";
                this._notFoundLyricMessage = messages.notFoundLyric || "";

                this._lyricExpanded = false;

                this._CustomPlaylist= handlers.CustomPlaylist !== void 0 ? handlers.CustomPlaylist : false;
                this._showAlbumName = config.showAlbumName || false;
                this._enableLyric = config.enableLyric !== void 0 ? config.enableLyric : false;
                this._mute = config.mute !== void 0 ? config.mute : false;
                this._volume = config.volume !== void 0 ? config.volume : 100;
                this._random = config.random !== void 0 ? config.random : false;
                this._mode = config.mode !== void 0 && isValidMode(config.mode) ? config.mode : TrackMode.REPEAT_LIST;
                this._handlers = config.handlers;
                this._initialized = false;
                this._destructed = false;
                this._$container = $(container);
                this._$UI = null;
                this._$PlayerControls = null;
                this._$PlaybackTimelineSlider = null;
                this._$VolumeSlider = null;
                this._$TrackLisContainer = null;
                this._$TrackListWrapper = null;
                this._$TrackListRightClickMenu = null;
                this._$TrackList = null;
                this._$ModeButton = null;
                this._$RandomButton = null;
                this._$PlayToggleButton = null;
                this._$PlayPrevButton = null;
                this._$PlayNextButton = null;
                this._$VolumeButton = null;
                this._$TrackInfoTags = null;
                this._$Duration = null;
                this._$CurrentTime = null;
                this._$AlbumCoverContainer = null;
                this._$Lyric = null;
                this._$LyricContent = null;
                this._$LyricExtend = null;
                this._$LyricExtendWrapper = null;
                this._$LyricExtendContent = null;
                this._$LyricExtendCloseButton = null;
                this._TrackListSimpleBar = null;
                this._LyricExtendSimpleBar = null;
                this._focusedTrackItemOnRightClick = null;

                this._onPlaybackTimelineChange = this._handlePlaybackTimelineChange.bind(this);
                this._onVolumeChangeHandler = this._handleVolumeChange.bind(this);
                this._onPlayToggleButtonClickHandler = this._handlePlayToggleButtonClick.bind(this);
                this._onPrevButtonClickHandler = this._handlePrevButtonClick.bind(this);
                this._onNextButtonClickHandler = this._handleNextButtonClick.bind(this);
                this._onModeButtonClickHandler = this._handleModeButtonClick.bind(this);
                this._onRandomButtonClickHandler = this._handleRandomButtonClick.bind(this);
                this._onVolumeButtonClickHandler = this._handleVolumeButtonClick.bind(this);
                this._onTrackItemClickHandler = this._handleTrackItemClick.bind(this);
                this._onResizeHandler = this._onResize.bind(this);
                this._onDocumentClickHandler = this._handleDocumentClick.bind(this);
                this._onTrackListContextHandler = this._handleTrackListContext.bind(this);
                this._onLyricClickHandler = this._handleLyricClick.bind(this);
                this._onExtendedLyricCloseButtonClickHandler = this._handleExtendedLyricCloseButtonClick.bind(this);
                this._onExtendedLyricLineClickHandler = this._handleExtendedLyricLineClick.bind(this);

                this._init();
            }

            UI.msecToTimeStr = function(time) {
                var sec_num = Math.floor(parseInt(time, 10)/1000); // don't forget the second param
                if(!sec_num || isNaN(sec_num)) {
                    sec_num = 0;
                }
                var minutes = Math.floor((sec_num) / 60);
                var seconds = sec_num - (minutes * 60);
                if (seconds < 10) {
                    seconds = "0"+seconds;
                }

                return minutes+':'+seconds;
            };

            UI.getTrackInfoTagsTemplate = function(title, artist, album) {
                var html = '<div class="Tags__Title"> <span>'+(title ? title : 'unknown')+'</span></div>';
                if(album) {
                    html += '<div class="Tags__Album"><span>'+album+'</span></div>';
                }
                if(artist) {
                    html += '<div class="Tags__Artist"><span>'+artist+'</span></div>';
                }


                return html;
            };

            UI.getAlbumCoverTemplate = function(url) {
                return url ? ('<img class="AlbumCover__image" src="'+url+'" />') : '';
            };

            UI.getTrackListRightClickTemplate = function(menuObj, trackItem, player, menuCloseHandler) {
                var isAppended = false;
                var $ul = $('<ul></ul>');
                if(menuObj) {
                    menuObj.forEach(function(each){
                        var name = each.name;
                        var handler = each.handler;
                        var callback = function() {
                            if(handler && typeof handler === 'function') {
                                handler(trackItem, player);
                            }
                            if(menuCloseHandler) {
                                menuCloseHandler();
                            }
                        };
                        var $li = $('<li>'+name+'</li>');
                        $li.click(callback);
                        $ul.append($li);
                        isAppended = true;
                    });

                    if(isAppended) {
                        return $ul;
                    }
                }

                return null;
            };

            UI.prototype.getPlayerTemplate = function() {
                var id = this._Player.getID();
                var html = '<div class="BluePlayer__container">\n' +
                    '    <div id="BluePlayer" class="mobile'+(id !== void 0 ? (' PlayerID_'+id) : '')+'">\n' +
                    '\n' +
                    '        <div class="BluePlayer__Controls__container">\n' +
                    '            <div class="BluePlayer__Controls">\n' +
                    '                <div class="BluePlayer__TrackInfo">\n' +
                    '<div class="TrackInfo__Lyric__extend">' +
                    '<div class="closeBtn__section">' +
                    '<a class="controls-Icon" href="javascript:;" title="'+this._closeLabel+'"><i class="close"></i></a>' +
                    '</div>' +
                    '<div class="LyricExtend__wrapper"><div class="LyricExtend__content"></div></div>' +
                    '</div>' +
                    '                    <div class="TrackInfo__Description__container">\n' +
                    '                        <div class="TrackInfo__Description">\n' +
                    '                            <div class="TrackInfo__AlbumCover">\n' +
                    '                                <div class="AlbumCover__image__container">\n' +
                    //'                                    <img class="AlbumCover__image" src="./no_cover.png" />\n' +
                    '                                </div>\n' +
                    '                            </div>\n' +
                    '                            <div class="TrackInfo__Tags__wrapper">\n' +
                    '                                <div class="TrackInfo__Tags">\n' +
                    '                                    <div class="Tags__Title">\n' +
                    '                                        <p>Unknown</p>\n' +
                    '                                    </div>\n' +
                    '                                    <div class="Tags__Artist">\n' +
                    '                                        <p>Unknown</p>\n' +
                    '                                    </div>\n' +
                    '                                </div>\n' +
                    '                            </div>\n' +
                    '                        </div>\n' +
                    '                    </div>\n' +
                    '\n' +
                    '                    <div class="TrackInfo__Lyric__container">\n' +
                    '                        <div class="TrackInfo__Lyric">\n' +
                    '                            <div class="Lyric__contents">\n' +
                    '                                <span class="wait">'+this._notFoundLyricMessage+'</span>\n' +
                    '                            </div>\n' +
                    '                        </div>\n' +
                    '                    </div>\n' +
                    '\n' +
                    '                </div>\n' +
                    '\n' +
                    '                <div class="Controls__container">\n' +
                    '                    <div class="PlaybackTimeline__container">\n' +
                    '                        <div class="PlaybackTimeline">\n' +
                    '                            <div class="PlaybackTimeline__TimePassed">\n' +
                    '                                <span>0:00</span>\n' +
                    '                            </div>\n' +
                    '                            <div class="PlaybackTimeline__ProgressBar">\n' +
                    '\n' +
                    '                            </div>\n' +
                    '                            <div class="PlaybackTimeline__Duration">\n' +
                    '                                <span>0:00</span>\n' +
                    '                            </div>\n' +
                    '                            <div class="clear"></div>\n' +
                    '                        </div>\n' +
                    '                    </div>\n' +
                    '\n' +
                    '                    <div class="Controls__ControlBtns__container">\n' +
                    '                        <div class="ControlBtns__Left">\n' +
                    '                            <a href="javascript:;" class="controls-Icon repeat repeatStats" title="'+this._repeatLabel+'"></a>\n' +
                    '                            <a href="javascript:;" class="controls-Icon random randomStats" title="'+this._randomLabel+'"></a>\n' +
                    '                        </div>\n' +
                    '\n' +
                    '                        <div class="ControlBtns__Right">\n' +
                    '                            <div class="ControlBtns__Volume">\n' +
                    '                                <a href="javascript:;" class="controls-Icon volume volume-large"></a>\n' +
                    '                                <div class="Volume__Slider">\n' +
                    '\n' +
                    '                                </div>\n' +
                    '                            </div>\n' +
                    '                        </div>\n' +
                    '                        <div class="clear"></div>\n' +
                    '                        <div class="ControlBtns__Main">\n' +
                    '                            <a href="javascript:;" class="controls-Icon playPrev" title="'+this._skipBackwardLabel+'"</a>\n' +
                    '                            <a href="javascript:;" class="controls-Icon play playStats" title="'+this._playLabel+'"></a>\n' +
                    '                            <a href="javascript:;" class="controls-Icon playNext" title="'+this._skipForwardLabel+'"></a>\n' +
                    '                        </div>\n' +
                    '                    </div>\n' +
                    '                </div>\n' +
                    '            </div>\n' +
                    '        </div>\n' +
                    '\n' +
                    '        <div class="BluePlayer__TrackList__container">' +
                    '<div class="TrackList__RightClick"></div>' +
                    '            <div class="BluePlayer__TrackList">\n' +
                    '                <div class="TrackList">\n' +
                    '                </div>\n' +
                    '            </div>\n' +
                    '        </div>\n' +
                    '        <div class="clear"></div>\n' +
                    '    </div>\n' +
                    '</div>';

                return html;
            };

            UI.prototype.getTrackItemTemplate = function(trackItem, enableMoreButton) {
                var id = trackItem.id;
                var title = trackItem.title;
                var artist = trackItem.artist;
                var album = trackItem.album;
                var showAlbumName = this._showAlbumName;
                var albumArt = trackItem.albumArt;
                var duration = trackItem.duration;
                var controlsTemplate = null;
                if(!showAlbumName) {
                    album = null;
                }

                var html = '<div class="TrackItem" data-id="'+id+'">\n' +
                    '<div class="TrackItemDescription">\n' +
                    '<div class="TrackItemDescription__left">\n' +
                    '<div class="albumCover__wrapper">\n' +
                    '<div class="albumCover">' +
                    (albumArt ? ('<img class="albumCover__img" src="'+albumArt+'" />') : '') +
                    '</div></div><div class="info"><div class="artist">'+
                    (artist ? ('<span>'+artist+'</span>') : '') +
                    (artist && album ? '<span class="separator"> - </span>' : '') +
                    (album ? ('<span class="album">'+album+'</span>') : '') +
                    '</div><div class="title"><span>'+title+'</span>' +
                    '</div></div></div>';

                enableMoreButton = true;
                if(trackItem.allowRemove || enableMoreButton) {
                    controlsTemplate = '<div class="controls">';
                    if(trackItem.allowRemove) {
                        controlsTemplate += '<a class="controls-icon remove" href="javascript:;" title="'+this._removeLabel+'"><i class="icon"></i></a>';
                    }
                    if(enableMoreButton) {
                        controlsTemplate += '<a class="controls-icon more" href="javascript:;" title="'+this._moreLabel+'"><i class="icon"></i></a>';
                    }
                    controlsTemplate += '</div>';
                }

                    html += '<div class="TrackItemDescription__right'+(controlsTemplate ? ' enableControl' : '')+'">' +
                        (controlsTemplate ? controlsTemplate : '') +
                    '<div class="duration"><span>'+(duration ? UI.msecToTimeStr(duration) : '')+'</span>' +
                    '</div>' +
                    ' </div>' +
                    ' <div class="clear"></div>' +
                    ' </div>' +
                    '</div>';

                return html;
            };

            UI.prototype._ensureNotDestructed = function() {
                if(this.isDestructed()) {
                    throw new Error("UI was destructed");
                }
            };

            UI.prototype._init = function() {
                if(!this._initialized) {
                    var that = this;
                    var $template = $(this.getPlayerTemplate());
                    this._$UI = $template.find('#BluePlayer');
                    this._$PlayerControls = this._$UI.find('.BluePlayer__Controls');
                    this._$PlaybackTimelineSlider = this._$UI.find('.PlaybackTimeline__ProgressBar');
                    this._$VolumeSlider = this._$UI.find('.Volume__Slider');
                    this._$TrackLisContainer = this._$UI.find('.BluePlayer__TrackList__container');
                    this._$TrackListWrapper = this._$UI.find('.BluePlayer__TrackList');
                    this._$TrackListRightClickMenu = this._$TrackLisContainer.find('.TrackList__RightClick');
                    this._$TrackList = this._$TrackLisContainer.find('.TrackList');
                    this._$ModeButton = this._$UI.find('.ControlBtns__Left .repeatStats');
                    this._$RandomButton = this._$UI.find('.ControlBtns__Left .randomStats');
                    this._$PlayToggleButton = this._$UI.find('.ControlBtns__Main .playStats');
                    this._$PlayPrevButton = this._$UI.find('.ControlBtns__Main .playPrev');
                    this._$PlayNextButton = this._$UI.find('.ControlBtns__Main .playNext');
                    this._$VolumeButton = this._$UI.find('.ControlBtns__Volume .volume');
                    this._$TrackInfoTags = this._$UI.find('.TrackInfo__Tags');
                    this._$Duration = this._$UI.find('.PlaybackTimeline__Duration span');
                    this._$CurrentTime = this._$UI.find('.PlaybackTimeline__TimePassed span');
                    this._$AlbumCoverContainer = this._$UI.find('.AlbumCover__image__container');
                    this._$Lyric = this._$UI.find('.TrackInfo__Lyric');
                    this._$LyricContent = this._$UI.find('.TrackInfo__Lyric__container .Lyric__contents');
                    this._$LyricExtend = this._$UI.find('.TrackInfo__Lyric__extend');
                    this._$LyricExtendWrapper = this._$LyricExtend.find('.LyricExtend__wrapper');
                    this._$LyricExtendContent = this._$LyricExtend.find('.LyricExtend__content');
                    this._$LyricExtendCloseButton = this._$LyricExtend.find('.closeBtn__section a');
                    this._$PlaybackTimelineSlider.slider({
                        orientation: "horizontal",
                        range: "min",
                        max: 0,
                        value: 0,
                        slide: this._onPlaybackTimelineChange,
                        start: sliderStartHandler,
                        stop: sliderStopHandler
                    });
                    this._$PlaybackTimelineSlider.prepend('<div class="PlaybackTimelineSlider__extend"></div>');

                    this._$VolumeSlider.slider({
                        orientation: "horizontal",
                        range: "min",
                        max: 100,
                        value: this._volume,
                        slide: this._onVolumeChangeHandler,
                        start: sliderStartHandler,
                        stop: sliderStopHandler
                    });
                    this._$VolumeSlider.prepend('<div class="VlumeSlider__extend"></div>');


                    $(document).on('click touchstart', this._onDocumentClickHandler);
                    this._$TrackLisContainer.on('contextmenu', this._onTrackListContextHandler);
                    this._$PlayToggleButton.on('click', this._onPlayToggleButtonClickHandler);
                    this._$PlayPrevButton.on('click', this._onPrevButtonClickHandler);
                    this._$PlayNextButton.on('click', this._onNextButtonClickHandler);
                    this._$ModeButton.on('click', this._onModeButtonClickHandler);
                    this._$RandomButton.on('click', this._onRandomButtonClickHandler);
                    this._$VolumeButton.on('click', this._onVolumeButtonClickHandler);
                    this._$TrackLisContainer.on('click', '.TrackList .TrackItem[data-id]', this._onTrackItemClickHandler);
                    this._$Lyric.on('click', this._onLyricClickHandler);
                    this._$LyricExtendCloseButton.on('click', this._onExtendedLyricCloseButtonClickHandler);
                    this._$LyricExtendContent.on('click', '.lrc[data-position]', this._onExtendedLyricLineClickHandler);
                    this._$container.html(this._$UI);
                    this._initialized = true;
                    if(!this._CustomPlaylist && this._mode === TrackMode.CUSTOM_LIST) {
                        this._mode = TrackMode.REPEAT_LIST;
                    }
                    if('SimpleBar' in window) {
                        this._TrackListSimpleBar = new SimpleBar(this._$TrackListWrapper[0]);
                        if(this.isEnabledLyric()) {
                            this._LyricExtendSimpleBar = new SimpleBar(this._$LyricExtendWrapper[0], {
                                autoHide: false
                            });
                        }
                    }
                    this._ListClusterize = new window.Clusterize({
                        rows: [],
                        scrollElem: this._TrackListSimpleBar ? this._TrackListSimpleBar.getScrollElement() : this._$TrackListWrapper[0],
                        contentElem: this._$TrackList[0],
                        rows_in_block: 10,
                        show_no_data_row: false,
                        tag: 'div',
                        callbacks: {
                            clusterChanged: function(e){
                                that._onClusterChanged();
                            }
                        }
                    });

                    this.setRandom(this._random);
                    this.setMode(this._mode);
                    this.enableLyric(this._enableLyric);

                    $(window).on('resize', this._onResizeHandler);
                    this._resizePlayer();
                }

            };

            UI.prototype._onClusterChanged = function() {
                if(this._currentTrackItem) {
                    var trackID = this._currentTrackItem.id;
                    var $currentTrackItem = this._$TrackList.find('.TrackItem[data-id="'+trackID+'"]');
                    if($currentTrackItem.length && !$currentTrackItem.hasClass('current')) {
                        $currentTrackItem.addClass('current');
                    }
                }
                this._focusTrackItemOnRightClick();
            };

            UI.prototype._onResize = function() {
                this._resizePlayer();
            };

            UI.prototype._handleTrackItemClick = function(evt) {
                var $item = $(evt.currentTarget);
                var $target = $(evt.srcElement ? evt.srcElement : evt.target);
                var $parents = $target.parent('.controls-icon');
                if($parents.length) {
                    $target = $parents;
                }
                var trackID = $item.attr('data-id');
                if(trackID) {
                    trackID = parseInt(trackID, 10);
                    var playlist = this._Player._Playlist;
                    var trackItem = playlist.getTrackItem(trackID);
                    if($target.length && $target.hasClass('controls-icon')) {
                        if($target.hasClass('remove')) {
                            this._handleRemoveButtonClick(trackItem);
                        } else if($target.hasClass('more')) {
                            this._handleMoreButtonClick(trackItem, $target, evt);
                        }
                    } else {
                        var player = this._Player;
                        var playback = player._Playback;
                        if(playback && playback.getCurrentTrackItem() === trackItem) {
                            if(playback.isReady()) {
                                if(playback.isPlaying()) {
                                    playback.pause();
                                    this.setUIPlaying();
                                } else {
                                    playback.play();
                                }
                            }
                        } else {
                            this.setCurrentTrackItem(trackItem);
                            this.onTrackItemClick.dispatch(trackItem);
                        }
                    }
                }
            };

            UI.prototype._handlePlayToggleButtonClick = function() {
                if(this.isUIPaused()) {
                    this._handlePauseButtonClick();
                } else {
                    this._handlePlayButtonClick();
                }
            };

            UI.prototype._handlePlayButtonClick = function() {
                var playback = this._Player._Playback;
                this.setUIPaused();
                playback.play();
                this.onPlayButtonClick.dispatch(void 0);
            };

            UI.prototype._handlePauseButtonClick = function() {
                var playback = this._Player._Playback;
                this.setUIPlaying();
                playback.pause();
                this.onPauseButtonClick.dispatch(void 0);
            };

            UI.prototype._handlePrevButtonClick = function() {
                this.onPreviousButtonClick.dispatch(void 0);
            };

            UI.prototype._handleNextButtonClick = function() {
                this.onNextButtonClick.dispatch(void 0);
            };

            UI.prototype._handleModeButtonClick = function() {
                var mode = this.getMode();
                var nextMode = TrackMode[mode+1] !== void 0 ? mode+1 : 0;
                if(!this._CustomPlaylist && nextMode === TrackMode.CUSTOM_LIST) {
                    nextMode = TrackMode[nextMode+1] !== void 0 ? nextMode+1 : 0;
                }

                this.setMode(nextMode);
                this.onModeButtonClick.dispatch(nextMode);
            };

            UI.prototype._handleRandomButtonClick = function() {
                var random = this.isRandom();
                this.setRandom(!random);
                this.onRandomButtonClick.dispatch(!random);
            };

            UI.prototype._handleRemoveButtonClick = function(trackItem) {
                if(trackItem) {
                    var player = this._Player;
                    var playlist = player._Playlist;
                    var playback = player._Playback;
                    var controller = player._Controller;
                    if(trackItem === playback.getCurrentTrackItem()) {
                        controller.skipForwardTrack(playback.isPlaying() || playback.isSignalledPlay());
                    }
                    playlist.removeTrackItem(trackItem);
                    this.removeTrackItem(trackItem.id);
                    this.onTrackRemoveClick.dispatch(trackItem);
                }
            };

            UI.prototype._handleMoreButtonClick = function(trackItem, $target, evt) {
                if(trackItem) {
                    var trackListContainerOffset = this._getTrackListContainerOffset();
                    var targetOffset = $target.offset();
                    var containerOffsetX = trackListContainerOffset.left;
                    var containerOffsetY = trackListContainerOffset.top;
                    var offsetX = targetOffset.left - containerOffsetX;
                    var offsetY = targetOffset.top - containerOffsetY;
                    var menuObj = this._getRightClickMenu(trackItem);
                    var targetWidth = $target.outerWidth();
                    var targetHeight = $target.outerHeight();
                    if(targetWidth) {
                        offsetX += targetWidth/2;
                    }
                    if(targetHeight) {
                        offsetY += targetHeight/2;
                    }

                    this._showTrackListRightClickMenu(menuObj, trackItem, offsetX, offsetY);
                }
            };

            UI.prototype._handleVolumeButtonClick = function() {
                var playback = this._Player._Playback;
                var mute = this.isMuted();
                this.setMute(!mute);
                playback.setMute(!mute);
                this.onVolumeButtonClick.dispatch(!mute);
            };

            UI.prototype._handleVolumeChange = function(evt, ui) {
                var playback = this._Player._Playback;
                var volume = ui ? ui.value : void 0;
                if(volume === void 0) {
                    volume = this._$VolumeSlider.slider('value');
                }
                if(this.isMuted()) {
                    this.setMute(false);
                    playback.setMute(false);
                }
                this.onVolumeChange.dispatch(volume);
                this.setVolume(volume, false, true);
                playback.setVolume(volume);
            };

            UI.prototype._handleLyricClick = function() {
                this._showLyricExtend();
            };

            UI.prototype._handleExtendedLyricLineClick = function(evt) {
                var $this = $(evt.target || evt.srcElement);
                var position = parseInt($this.attr('data-position'), 10);
                if(!isNaN(position) && position !== void 0) {
                    var player = this._Player;
                    var playback = player._Playback;
                    if(playback && playback.isReady()) {
                        playback.seek(Math.min(playback.getDuration(), position+10));
                    }
                }
            };

            UI.prototype._handleExtendedLyricCloseButtonClick = function() {
                this._hideLyricExtend();
            };

            UI.prototype._handlePlaybackTimelineChange = function(evt, ui) {
                var playback = this._Player._Playback;
                var position = ui.value;
                this._setCurrentPosition(position);
                playback.seek(position);
                this.onPlaybackTimelineChange.dispatch(position);
            };

            UI.prototype._handleTrackListContext = function(evt) {
                var $target = $(evt.srcElement ? evt.srcElement : evt.target);
                var $TrackItem = $target.hasClass('TrackItem') ? $target : $target.parents('.TrackItem');
                var trackItemID = $TrackItem.attr('data-id');
                if($TrackItem.length && trackItemID) {
                    trackItemID = parseInt(trackItemID, 10);
                    var playback = this._Player._Playback;
                    var trackItem = this._Player._Playlist.getTrackItem(trackItemID);
                    if(trackItem) {
                        var trackListContainerOffset = this._getTrackListContainerOffset();
                        var containerOffsetX = trackListContainerOffset.left;
                        var containerOffsetY = trackListContainerOffset.top;
                        var offsetX = evt.pageX - containerOffsetX;
                        var offsetY = evt.pageY - containerOffsetY;
                        var menuObj = this._getRightClickMenu(trackItem);

                        this._showTrackListRightClickMenu(menuObj, trackItem, offsetX, offsetY);

                        return false;
                    }
                }

                return true;
            };

            UI.prototype._handleDocumentClick = function(evt) {
                var $target = $(evt.srcElement ? evt.srcElement : evt.target);
                var isMoreButton = $target.hasClass('controls-icon more') || $target.parents('.controls-icon.more').length > 0;
                if(!($target.parents('.TrackList__RightClick').length || $target.is(this._$TrackListRightClickMenu) || isMoreButton)) {
                    this._hideTrackListRightClickMenu();
                }
            };

            UI.prototype._showLyricExtend = function() {
                if(this.isEnabledLyric()) {
                    this._lyricExpanded = true;
                    if(!this._$PlayerControls.hasClass('extendLyric')) {
                        this._$PlayerControls.addClass('extendLyric');
                    }
                    this._resizeLyricExtend();
                }
            };

            UI.prototype._hideLyricExtend = function() {
                this._lyricExpanded = false;
                this._$PlayerControls.removeClass('extendLyric');
            };

            UI.prototype._getTrackListContainerOffset = function() {
                var $TrackLisContainer = this._$TrackLisContainer;
                var trackListContainerOffset = $TrackLisContainer.offset();
                var containerOffsetX = trackListContainerOffset.left;
                var containerOffsetY = trackListContainerOffset.top;

                return {
                    top: containerOffsetY,
                    left: containerOffsetX
                };
            };

            UI.prototype._getRightClickMenu = function(trackItem) {
                var menuObj = [];
                if(trackItem) {
                    var playback = this._Player._Playback;
                    if(playback.getCurrentTrackItem() !== trackItem || !playback.isPlaying()) {
                        menuObj.push({
                            name: this._rightClickPlayLabel,
                            handler: this._getTrackItemPlayHandler(trackItem)
                        });
                    } else {
                        menuObj.push({
                            name: this._rightClickPauseLabel,
                            handler: this._getTrackItemPauseHandler(trackItem)
                        });
                    }
                    if(trackItem.allowRemove) {
                        menuObj.push({
                            name: this._rightClickRemoveTrackLabel,
                            handler: this._getTrackItemRemoveHandler(trackItem)
                        });
                    }
                    if(this._handlers && this._handlers.trackMenu) {
                        menuObj = menuObj.concat(this._handlers.trackMenu(trackItem));
                    }
                }

                return menuObj;
            };

            UI.prototype._getTrackItemPlayHandler = function(trackItem) {
                if(trackItem) {
                    var that = this;
                    return function() {
                        var player = that._Player;
                        var playback = player._Playback;
                        var playlist = player._Playlist;
                        var controller = player._Controller;
                        var currentTrackItem = playback.getCurrentTrackItem();
                        var trackItemIdx = playlist.getTrackItemIndex(trackItem);
                        if(!player.isDestructed() && trackItemIdx >= 0) {
                            if(currentTrackItem !== trackItem) {
                                controller.setCurrentTrackItem(trackItem, true);
                            } else {
                                playback.play();
                            }
                        }
                    };
                }

                return null;
            };

            UI.prototype._getTrackItemPauseHandler = function(trackItem) {
                if(trackItem) {
                    var that = this;
                    return function() {
                        var player = that._Player;
                        var playback = player._Playback;
                        var playlist = player._Playlist;
                        var controller = player._Controller;
                        var currentTrackItem = playback.getCurrentTrackItem();
                        var trackItemIdx = playlist.getTrackItemIndex(trackItem);
                        if(!player.isDestructed() && trackItemIdx >= 0 && currentTrackItem === trackItem) {
                            controller.pause();
                        }
                    };
                }

                return null;
            };

            UI.prototype._getTrackItemRemoveHandler = function(trackItem) {
                if(trackItem) {
                    var that = this;
                    return function() {
                        return that._handleRemoveButtonClick(trackItem);
                    };
                }

                return null;
            };

            UI.prototype._resizePlayer = function() {
                if(this.isDestructed()) {
                    return;
                }
                var $UI = this._$UI;
                var playerWidth = this._$UI.width();
                var hasMobileClass = this.isMobileMode();
                var isTooSmall = playerWidth < 320;
                var isMobile = playerWidth < 650;
                var $rightControlSection = $UI.find('.ControlBtns__Right');
                if(isMobile) {
                    if(!hasMobileClass) {
                        $UI.addClass('mobile');
                    }
                    var playbackProgressBarWidth = playerWidth - 94;
                    this._$PlaybackTimelineSlider.css('width', playbackProgressBarWidth);
                    this._$TrackLisContainer.css('width', '100%');
                    this._$TrackListWrapper.css('max-height', '');
                } else if(!isMobile) {
                    this._$PlaybackTimelineSlider.css('width', 234);
                    if(hasMobileClass) {
                        $UI.removeClass('mobile');
                    }
                    var playerRect = this._$UI[0].getBoundingClientRect();
                    var actuallyPlayerWidth = playerRect.width ? playerRect.width : playerRect.right - playerRect.left;
                    var trackListWidth = Math.floor(actuallyPlayerWidth - 324);
                    var controlSectionHeight = $UI.find('.BluePlayer__Controls__container').height();
                    this._$TrackLisContainer.css('width', trackListWidth);
                    this._$TrackListWrapper.css('max-height', controlSectionHeight-1);
                }
                if(isTooSmall) {
                    $rightControlSection.hide();
                } else {
                    $rightControlSection.show();
                }

                this._resizeLyricExtend(isMobile);
                this._resizeTrackItemWidth(isMobile);
                this._ListClusterize.refresh();
                if(this._TrackListSimpleBar) {
                    this._TrackListSimpleBar.recalculate();
                    this._$TrackListWrapper.find('.simplebar-content-wrapper').css({
                        paddingRight: 0,
                        paddingBottom: 0
                    });
                }
            };

            UI.prototype._resizeTrackItemWidth = function(isMobile) {
                var trackListWidth = this._$TrackLisContainer.width();
                var strMaxWidth = trackListWidth - 130 + (isMobile ? 25 : 0);
                var playerID = this._Player.getID();
                var className = 'trackItemTextWidth';
                var css = '#BluePlayer.PlayerID_'+playerID+' .TrackItemDescription__left .info span {max-width: '+strMaxWidth+'px;}\n';
                css += '#BluePlayer.PlayerID_'+playerID+' .TrackItemDescription__left .info .artist {max-width: '+strMaxWidth+'px;}\n';
                css += '#BluePlayer.PlayerID_'+playerID+' .TrackItemDescription__right {left: '+(trackListWidth-67)+'px; height: 48px;}\n';
                if(this.isEnabledLyric()) {
                    var $rightControlSection = this._$PlayerControls;
                    var rightControlWidth = $rightControlSection.width();
                    css += '#BluePlayer.PlayerID_'+playerID+' .TrackInfo__Lyric .Lyric__contents span {width: '+(rightControlWidth-1)+'px;}\n';
                }

                var $lastCSS = this._$UI.find('style#BluePlayer__'+playerID+"."+className);
                if($lastCSS.length) {
                    $lastCSS.remove();
                }

                var html = trackListCSS(playerID, className, css);
                this._$UI.prepend(html);
            };

            UI.prototype._resizeLyricExtend = function() {
                var $UI = this._$UI;
                var playerWidth = this._$UI.width();
                var isMobile = playerWidth < 650;
                var $TrackInfo = this._$UI.find('.BluePlayer__TrackInfo');
                var controlSectionWidth = this._$UI.find('.BluePlayer__Controls__container').width();
                var trackInfoHeight = isMobile ? this._$PlayerControls.height() : $TrackInfo.height()-22;
                var $LyricExtendWrapper = this._$LyricExtendWrapper;
                $LyricExtendWrapper.css({
                    width: controlSectionWidth,
                    height: trackInfoHeight
                });
                var $LyricExtendWrapperScrollContent = $LyricExtendWrapper.find('.simplebar-content');
                if($LyricExtendWrapperScrollContent.length) {
                    $LyricExtendWrapperScrollContent.css({
                        width: controlSectionWidth,
                        height: trackInfoHeight,
                        display: 'table-cell',
                        verticalAlign: 'middle'
                    });
                }
                if(this.isLyricExpanded()) {
                    var player = this._Player;
                    var lyric = player._Lyric;
                    if(lyric) {
                        var lyricOffsets = lyric.getRecentLyricOffset();
                        if(lyricOffsets && lyricOffsets.length > 0) {
                            this.focusExtendedLyricLine(lyricOffsets);
                        }
                    }
                }
            };

            UI.prototype._reflectTrackItemToPlayer = function(trackItem) {
                var showAlbumName = this._showAlbumName;
                this._setTitleAndArtist(trackItem.title, trackItem.artist, showAlbumName ? trackItem.album : null);
                this._setAlbumCover(trackItem.albumArt);
                if(trackItem.duration) {
                    var duration = trackItem.duration && !isNaN(trackItem.duration) ? trackItem.duration : 0;
                    this.setDuration(duration);
                }
            };

            UI.prototype._getTrackItemNode = function(trackItem) {
                var id = trackItem.id;
                var $target = this._$TrackList.find('.TrackItem[data-id="'+id+'"]');
                return $target.length ? $target : null;
            };

            UI.prototype._showTrackListRightClickMenu = function(menuObject, trackItem, posX, posY) {
                this._focusoutTrackItemOnRightClick();
                var player = this._Player;
                var $template = this.constructor.getTrackListRightClickTemplate(menuObject, trackItem, player, this._hideTrackListRightClickMenu.bind(this));
                if($template) {
                    this._$TrackListRightClickMenu.html('');
                    this._$TrackListRightClickMenu.css({
                        top: posY,
                        left: posX
                    });
                    this._$TrackListRightClickMenu.append($template);
                    this._$TrackListRightClickMenu.addClass('show');
                    this._focusedTrackItemOnRightClick = trackItem;
                    this._focusTrackItemOnRightClick();
                } else {
                    this._hideTrackListRightClickMenu();
                }
            };

            UI.prototype._hideTrackListRightClickMenu = function() {
                this._focusoutTrackItemOnRightClick();
                this._$TrackListRightClickMenu.html('');
                this._$TrackListRightClickMenu.removeClass('show');
            };

            UI.prototype._focusTrackItemOnRightClick = function() {
                if(this._focusedTrackItemOnRightClick) {
                    var focusedTrackItemID = this._focusedTrackItemOnRightClick.id;
                    var $focusedTrackItem = this._$TrackList.find('.TrackItem[data-id="'+focusedTrackItemID+'"]');
                    if($focusedTrackItem.length && !$focusedTrackItem.hasClass('rightClick')) {
                        $focusedTrackItem.addClass('rightClick');
                    }
                }
            };

            UI.prototype._focusoutTrackItemOnRightClick = function() {
                if(this._focusedTrackItemOnRightClick) {
                    var focusedTrackItemID = this._focusedTrackItemOnRightClick.id;
                    var $focusedTrackItem = this._$TrackList.find('.TrackItem[data-id="'+focusedTrackItemID+'"]');
                    $focusedTrackItem.removeClass('rightClick');
                    this._focusedTrackItemOnRightClick = null;
                }
            };

            UI.prototype._setTitleAndArtist = function(title, artist, album) {
                var templateHTML = this.constructor.getTrackInfoTagsTemplate(title, artist, album);
                this._$TrackInfoTags.html(templateHTML);
            };

            UI.prototype._setAlbumCover = function(albumArtURL) {
                //var templateHTML = this.constructor.getAlbumCoverTemplate(albumArtURL);
                //this._$AlbumCoverContainer.html(templateHTML);
                this._$AlbumCoverContainer.css('background-image', albumArtURL ? ('url("'+albumArtURL+'")') : '');
            };

            UI.prototype._setCurrentPosition = function(position) {
                if(!position || isNaN(position)) {
                    position = 0;
                }
                this._$CurrentTime.html(this.constructor.msecToTimeStr(position));
            };

            UI.prototype._isPlaybackTimelineSliding = function() {
                return this._$PlaybackTimelineSlider.hasClass('sliding');
            };

            UI.prototype._isVolumeSliding = function() {
                return this._$VolumeSlider.hasClass('sliding');
            };

            UI.prototype.setRandom = function(random) {
                this._ensureNotDestructed();
                this._random = random;
                if(random) {
                    this._$RandomButton.addClass('active');
                } else {
                    this._$RandomButton.removeClass('active');
                }
            };

            UI.prototype.setMode = function(mode) {
                this._ensureNotDestructed();
                this._mode = mode;
                this._$ModeButton.removeClass('repeat-default repeat-one repeat-and-auto active');
                var title = null;
                switch(mode) {
                    case TrackMode.NONE:
                        this._$ModeButton.addClass('repeat-default');
                        break;

                    case TrackMode.REPEAT_LIST:
                        this._$ModeButton.addClass('repeat-default active');
                        title = 'Repeat';
                        break;

                    case TrackMode.REPEAT_TRACK:
                        this._$ModeButton.addClass('repeat-one active');
                        title = 'Repeat Track';
                        break;

                    case TrackMode.CUSTOM_LIST:
                        this._$ModeButton.addClass('repeat-and-auto active');
                        title = 'Custom List';
                        break;
                }
            };

            UI.prototype.setDuration = function(duration) {
                this._ensureNotDestructed();
                if(!duration || isNaN(duration)) {
                    duration = 0;
                }
                this._$PlaybackTimelineSlider.slider('option', 'max', duration);
                this._$Duration.html(this.constructor.msecToTimeStr(duration));
            };

            UI.prototype.setPosition = function(position, isForce) {
                this._ensureNotDestructed();
                if(this._isPlaybackTimelineSliding() && !isForce) {
                    return;
                }
                if(!position || isNaN(position)) {
                    position = 0;
                }
                this._$PlaybackTimelineSlider.slider('value', position);
                this._setCurrentPosition(position);
            };

            UI.prototype.setUIPlaying = function() {
                this._ensureNotDestructed();
                if(this._$PlayToggleButton.hasClass('pause')) {
                    this._$PlayToggleButton.removeClass('pause')
                } else if(!this._$PlayToggleButton.hasClass('play')) {
                    this._$PlayToggleButton.addClass('play');
                }
                this._$PlayToggleButton.attr('title', this._playLabel);
            };

            UI.prototype.setUIPaused = function() {
                this._ensureNotDestructed();
                if(!this._$PlayToggleButton.hasClass('play')) {
                    this._$PlayToggleButton.removeClass('play');
                } else if(!this._$PlayToggleButton.hasClass('pause')) {
                    this._$PlayToggleButton.addClass('pause');
                }
                this._$PlayToggleButton.attr('title', this._pauseLabel);
            };

            UI.prototype.enableLyric = function(enable) {
                this._ensureNotDestructed();
                if(enable) {
                    this._$PlayerControls.addClass('EnableLyric');
                } else {
                    this._$PlayerControls.removeClass('EnableLyric');
                }
            };

            UI.prototype.isUIPaused = function() {
                if(this.isDestructed()) {
                    return null;
                }
                return this._$PlayToggleButton.hasClass('pause');
            };

            UI.prototype.isDestructed = function() {
                return this._destructed;
            };

            UI.prototype.isEnabledLyric = function() {
                if(this.isDestructed()) {
                    return null;
                }
                return this._enableLyric;
            };

            UI.prototype.updateLyric = function(lyricArr) {
                if(this.isEnabledLyric()) {
                    if(!lyricArr || !lyricArr.length) {
                        this._$LyricContent.html('');
                    } else if(lyricArr.length > 0) {
                        var html = [];
                        lyricArr.forEach(function(eachLyric){
                            html.push('<span'+(eachLyric.wait ? ' class="wait"' : '')+'>'+eachLyric.text+'</span>');
                        });

                        this._$LyricContent.html(html.join(''));
                    }
                }
            };

            UI.prototype.updateExtendedLyric = function(lyric, isNotice) {
                var html = lyric && lyric.length > 0 ? getExtendedLyricLyric(lyric, isNotice) : '';
                this._$LyricExtendContent.html(html);
            };

            UI.prototype.focusExtendedLyricLine = function(offsets) {
                if(!this.isLyricExpanded()) {
                    return false;
                }
                var $ExtendedLyricContent = this._$LyricExtendContent;
                $ExtendedLyricContent.find('.focus').each(function(){
                    $(this).removeClass('focus');
                });
                if(offsets && offsets.length > 0) {
                    var $elements = [];
                    offsets.forEach(function(offset) {
                        var $target = $ExtendedLyricContent.find('span[data-index="'+offset+'"]');
                        if($target.length > 0) {
                            $elements.push($target);
                            $target.addClass('focus');
                        }
                    });
                    this.scrollExtendedLyricLine($elements);
                }
            };

            UI.prototype.scrollExtendedLyricLine = function($elements) {
                var $ScrollElement = $(this._LyricExtendSimpleBar.getScrollElement());
                if($elements === void 0) {
                    $ScrollElement.scrollTop(0);
                    return;
                }
                var $LyricExtendWrapper = this._$LyricExtendWrapper;
                var LyricExtendWrapperOffset = $LyricExtendWrapper.offset();
                var LyricExtendWrapperHeight = $LyricExtendWrapper.height();
                var scrollTopPosition = $ScrollElement.scrollTop();
                var elementHeight = 0;
                if($elements && $elements.length > 0) {
                    $elements.forEach(function(each){
                        var $each = $(each);
                        elementHeight += $each.height();
                    });
                    var elementOffset = $elements[0].offset();
                    var scrollPosition = elementOffset.top+scrollTopPosition-LyricExtendWrapperOffset.top;
                    scrollPosition -= LyricExtendWrapperHeight/2 - elementHeight/2;
                    $ScrollElement.scrollTop(scrollPosition);
                }
            };

            UI.prototype.setVolume = function(volume, mute, isForce) {
                this._ensureNotDestructed();
                if(this._isVolumeSliding() && !isForce) {
                    return;
                }

                this._$VolumeButton.removeClass('volume-mute volume-small volume-large');
                if(volume <= 0) {
                    this._$VolumeButton.addClass('volume-mute');
                } else if(volume <= 60) {
                    this._$VolumeButton.addClass('volume-small');
                } else {
                    this._$VolumeButton.addClass('volume-large');
                }
                if(!mute) {
                    this._volume = volume;
                }
                this._$VolumeSlider.slider('value', volume);
            };

            UI.prototype.setMute = function(mute) {
                this._ensureNotDestructed();
                this._mute = mute;
                return this.setVolume(mute ? 0 : this._volume, mute);
            };

            UI.prototype.getMode = function() {
                if(this.isDestructed()) {
                    return null;
                }
                return this._mode;
            };

            UI.prototype.isMobileMode = function() {
                if(this.isDestructed()) {
                    return null;
                }
                return this._$UI.hasClass('mobile');
            };

            UI.prototype.isRandom = function() {
                if(this.isDestructed()) {
                    return null;
                }
                return this._random;
            };

            UI.prototype.isMuted = function() {
                if(this.isDestructed()) {
                    return null;
                }
                return this._mute;
            };

            UI.prototype.isLyricExpanded = function() {
                if(this.isEnabledLyric()) {
                    return this._lyricExpanded;
                }

                return false;
            };

            UI.prototype.addTrackItems = function(trackItems) {
                this._ensureNotDestructed();
                if(trackItems && trackItems.length) {
                    var that = this;
                    var templateDatas = [];
                    trackItems.forEach(function(trackItem){
                        if(trackItem) {
                            var templateHTML = that.getTrackItemTemplate(trackItem);
                            templateDatas.push({
                                TrackItem: trackItem,
                                template: templateHTML
                            });
                        }
                    });
                    if(templateDatas.length) {
                        var templates = templateDatas.map(function(each){
                            return each.template;
                        });
                        this._ListClusterize.append(templates);
                        this._TrackListTemplates = this._TrackListTemplates.concat(templateDatas);
                    }
                }
            };

            UI.prototype.removeTrackItem = function(trackItemID) {
                this._ensureNotDestructed();
                var templates = [];
                this._TrackListTemplates = this._TrackListTemplates.filter(function(each){
                    var isTarget = !!(each.TrackItem && each.TrackItem.id == trackItemID);
                    if(isTarget) {
                        return false;
                    } else {
                        templates.push(each.template);
                        return true;
                    }
                });
                this._ListClusterize.update(templates);
            };

            UI.prototype.scrollToTrackList = function(trackItem) {
                this._ensureNotDestructed();
                var $TrackList = this._$TrackList;
                var $TrackItems = $TrackList.find('.TrackItem');
                var trackItemHeight = null;
                if($TrackItems.length) {
                    trackItemHeight = $TrackItems.eq(0).height();
                }
                if(!trackItemHeight) {
                    return;
                }

                var listWrapperMaxHeight = this._$TrackListWrapper.css('max-height');
                if(listWrapperMaxHeight && typeof listWrapperMaxHeight === 'string') {
                    var regexdata = /\d+/.exec(listWrapperMaxHeight);
                    if(regexdata && regexdata.length > 0) {
                        listWrapperMaxHeight = parseInt(regexdata[0], 10);
                    }
                    if(isNaN(listWrapperMaxHeight)) {
                        listWrapperMaxHeight = null;
                    }
                } else {
                    listWrapperMaxHeight = 300;
                }

                var $TrackListWrapper = this._TrackListSimpleBar ? $(this._TrackListSimpleBar.getScrollElement()) : this._$TrackListWrapper;
                var playlist = this._Player._Playlist;
                var trackListWrapperHeight = (this.isMobileMode() ? listWrapperMaxHeight : ($TrackListWrapper.height() || this._$PlayerControls.height()));
                var totalCount = playlist.getTrackItemCount();
                var trackListHeight = totalCount * trackItemHeight;
                var idx = playlist.getTrackItemIndex(trackItem);
                var trackListWrapperHeightHalf = trackListWrapperHeight/2;
                if(idx > -1) {
                    var targetTrackHeightOffset = idx * trackItemHeight;
                    var targetScrollTopOffset = null;
                    if(targetTrackHeightOffset > trackListWrapperHeightHalf && trackListHeight-trackListWrapperHeightHalf>targetTrackHeightOffset) {
                        targetScrollTopOffset = targetTrackHeightOffset - trackListWrapperHeightHalf + (trackItemHeight/2);
                    } else if (targetTrackHeightOffset <= trackListWrapperHeightHalf) {
                        targetScrollTopOffset = 0;
                    } else if (trackListHeight-trackListWrapperHeightHalf<=targetTrackHeightOffset) {
                        targetScrollTopOffset = trackListHeight;
                    }
                    if(targetScrollTopOffset !== null) {
                        $TrackListWrapper.stop().animate({scrollTop: targetScrollTopOffset}, 250, 'swing');
                    }
                }
            };

            UI.prototype.focusTrackItemFromList = function (trackItem) {
                this._ensureNotDestructed();
                if(this._currentTrackItem) {
                    this.focusOutTrackItemFromList(this._currentTrackItem);
                }
                var $target = this._getTrackItemNode(trackItem);
                if($target) {
                    if(!$target.hasClass('current')) {
                        $target.addClass('current');
                    }
                }
            };

            UI.prototype.focusOutTrackItemFromList = function(trackItem) {
                this._ensureNotDestructed();
                var $target = this._getTrackItemNode(trackItem);
                if($target) {
                    $target.removeClass('current');
                }
            };

            UI.prototype.setCurrentTrackItem = function(trackItem) {
                this._ensureNotDestructed();
                this._reflectTrackItemToPlayer(trackItem);
                this.focusTrackItemFromList(trackItem);
                this.scrollToTrackList(trackItem);
                this.setPosition(0);
                this._currentTrackItem = trackItem;
            };

            UI.prototype.destruct = function() {
                if(!this.isDestructed()) {
                    if(this._TrackListSimpleBar) {
                        this._TrackListSimpleBar.removeObserver();
                        this._TrackListSimpleBar = null;
                    }
                    if(this._ListClusterize) {
                        this._ListClusterize.destroy();
                        this._ListClusterize = null;
                    }
                    this._TrackListTemplates = null;
                    $(window).off('resize', this._onResizeHandler);
                    $(document).off('click touchstart', this._onDocumentClickHandler);
                    this._$TrackLisContainer.off('contextmenu', this._onTrackListContextHandler);
                    this._$PlayToggleButton.off('click', this._onPlayToggleButtonClickHandler);
                    this._$PlayPrevButton.off('click', this._onPrevButtonClickHandler);
                    this._$PlayNextButton.off('click', this._onNextButtonClickHandler);
                    this._$ModeButton.off('click', this._onModeButtonClickHandler);
                    this._$RandomButton.off('click', this._onRandomButtonClickHandler);
                    this._$VolumeButton.off('click', this._onVolumeButtonClickHandler);
                    this._$TrackLisContainer.off('click', '.TrackList .TrackItem[data-id]', this._onTrackItemClickHandler);
                    this._$Lyric.off('click', this._onLyricClickHandler);
                    this._$LyricExtendCloseButton.off('click', this._onExtendedLyricCloseButtonClickHandler);
                    this._$LyricExtendContent.off('click', '.lrc[data-position]', this._onExtendedLyricLineClickHandler);
                    this._$PlaybackTimelineSlider.slider("destroy");
                    this._$VolumeSlider.slider("destroy");
                    this._$PlaybackTimelineSlider = null;
                    this._$VolumeSlider = null;
                    this._$UI.remove();
                    this._$UI = null;
                    this._$PlayerControls = null;
                    this._$VolumeSlider =  null;
                    this._$TrackLisContainer =  null;
                    this._$TrackListWrapper =  null;
                    this._$TrackListRightClickMenu =  null;
                    this._$TrackList =  null;
                    this._$ModeButton =  null;
                    this._$RandomButton =  null;
                    this._$PlayToggleButton =  null;
                    this._$PlayPrevButton =  null;
                    this._$PlayNextButton =  null;
                    this._$VolumeButton =  null;
                    this._$TrackInfoTags =  null;
                    this._$Duration =  null;
                    this._$CurrentTime =  null;
                    this._$AlbumCoverContainer = null;

                    this._destructed = true;
                }
            };

            return UI;
        }();

        var Playback = function() {

            var WEB_AUDIO_ACTIVE_TIMEOUT_MSECS = 5000;
            var FADE_TIME = 200;

            function checkWebAudioSupportBrowser() {
                return "AudioContext" in window;
            }

            function getWebAudio() {
                var checkMaxChannelCount = function(__WebAudio) {
                    if(!__WebAudio.destination.maxChannelCount) {
                        throw new Error("WebAudio output channels error");
                    }
                };
                if(!checkWebAudioSupportBrowser()) {
                    throw new Error("WebAudio is not supported");
                }
                var newWebAudio = new window.AudioContext;
                checkMaxChannelCount(newWebAudio);

                return newWebAudio;
            }

            // !!!FIXME
            function resumeWebAudio(_WebAudio){
                if(_WebAudio.state !== "suspended") {
                    return {
                        promise: Promise.resolve(),
                        abort: function(){}
                    };
                } else {
                    var isResolved = false;
                    var __reject = null;
                    var timer = null;
                    var promise = new Promise(function(resolve, reject) {
                        __reject = reject;
                        timer = window.setTimeout(function() {
                            reject({type:'timeout', error: null});
                        }, WEB_AUDIO_ACTIVE_TIMEOUT_MSECS);
                        _WebAudio.resume().then(function() {
                            window.clearTimeout(timer);
                            resolve();
                        })['catch'](function(error) {
                            window.clearTimeout(timer);
                            reject(error);
                        });
                    });
                    promise['catch'](function(e){
                        if(e instanceof Error){
                            console.error(e);
                        }
                    });

                    return {
                        promise: promise,
                        abort: function() {
                            if(timer !== null) {
                                window.clearTimeout(timer);
                                timer = null;
                            }
                            if(!isResolved) {
                                isResolved = true;
                                if(__reject) {
                                    __reject(void 0);
                                }
                            }
                        }
                    };
                }
            }

            function Playback(player, config) {
                this._audio = document.createElement('audio');
                this.onPlay = new EventDispatcher;
                this.onPlaying = new EventDispatcher;
                this.onPaused = new EventDispatcher;
                this.onAudioEnded = new EventDispatcher;
                this.onTimeUpdate = new EventDispatcher;
                this.onVolumeChange = new EventDispatcher;
                this.onDurationChange = new EventDispatcher;
                this.onActuallyPlaying = new EventDispatcher;
                this.onSeeking = new EventDispatcher;
                this.onSeeked = new EventDispatcher;

                this._actuallyPlayingDeferred = null;
                this._actuallyPlayingTimerID = null;
                this._actuallyPlayingTimerAttemptCount = 0;
                this._actuallyPlayingLastTimeStamp = null;
                this._actuallyPlaying = false;

                this._Player = player;
                this._seekTimerID = null;
                this._destructed = false;
                this._seekPosition = null;
                this._seekDeferred = null;

                this._signalledPlay = false;
                this._playDeferred = null;



                this._subscribers = [];
                this._listeners = [];

                this._activeFade = config.activeFade;
                this._fadeDuration = typeof config.fadeDuration === 'number' && !isNaN(config.fadeDuration) && config.fadeDuration > 0 ? config.fadeDuration : 200;
                this._WebAudio = null;
                this._process = {
                    fadeEndTimer: null,
                    direction: null,
                    value: null
                };

                this._currentTrackItem = null;
                this._onAudioTimeupdate = this._handleAudioTimeUpdateEvent.bind(this);
                this._onAudioPlaying = this._handleAudioPlayingEvent.bind(this);
                this._onAudioSeeked = this._handleAudioSeekedEvent.bind(this);
                this._onAudioSeeking = this._handleAudioSeekingEvent.bind(this);
                this._onAudioDurationChange = this._handleAudioDurationChangeEvent.bind(this);
                this._onAudioEnded = this._handleAudioEndedEvent.bind(this);
                this._onAudioPlay = this._handleAudioPlayEvent.bind(this);
                this._onAudioPaused = this._handleAudioPausedEvent.bind(this);
                this._onAudioVoluemChange = this._handleAudioVolumeChangeEvent.bind(this);
                this._onAudioLoadedMetadata = this._handleAudioLoadedMetadataEvent.bind(this);
                this._onAudioLoadedData = this._handleAudioLoadedDataEvent.bind(this);

                this._init();
            }

            Playback.prototype._init = function() {
                this._audio.preload = "metadata";
                this._audio.setAttribute('controlslist',["nodownload"]);
                this._registerAudioEvents();
                this._WebAudio = this._activeFade ? this._initWebAudio() : null;
                if(this._WebAudio) {
                    var mediaElementSource = this._WebAudio.context.createMediaElementSource(this._audio);
                    this._WebAudio.mediaElementSource = mediaElementSource;
                    mediaElementSource.connect(this._WebAudio.gainNode);
                }
            };

            Playback.prototype._initWebAudio = function() {
                if(!checkWebAudioSupportBrowser()) {
                    this._activeFade = false;
                }
                try {
                    var _AudioContext = getWebAudio();
                    var gain = _AudioContext.createGain();
                    gain.connect(_AudioContext.destination);
                    return {
                        context: _AudioContext,
                        gainNode: gain
                    };
                } catch(e) {
                    this._activeFade = false;
                    return null;
                }
            };

            Playback.prototype._activateWebAudio = function() {
                return this._WebAudio ? resumeWebAudio(this._WebAudio.context) : {
                    promise: Promise.resolve(),
                    abort: function(){}
                };
            };

            Playback.prototype.getWebAudioState = function() {
                if(!this._WebAudio || !this._WebAudio.context || !this._WebAudio.gainNode) {
                    return void 0;
                }
                var process = this._process;
                return process.direction;
            };

            Playback.prototype.applyWebAudioValue = function(value, fn) {
                var _before = this._beforeFade(fn);
                if(_before === void 0) {
                    return void 0;
                }
                this._applyFadeValue(value);
                fn();
            };

            Playback.prototype.processFade = function(direction, fn, fadeTime) {
                var that = this;
                var _before = this._beforeFade(fn);
                if(_before === void 0) {
                    return void 0;
                }
                var process = this._process;
                var callback = function() {
                    that._applyFadeValue(targetValue);
                    process.direction = null;
                    process.fadeEndTimer = null;
                    if(fn) {
                        fn();
                    }
                };
                process.direction = direction;
                var targetValue = direction === 'in' ? 1 : direction === 'out' ? 0 : null;
                var _webAudio = this._WebAudio.context;
                var gainNode = this._WebAudio.gainNode;
                if(targetValue === null) {
                    throw new Error("Direction is must be 'in' or 'out'.");
                }
                if(fadeTime === void 0) {
                    this._applyFadeValue(targetValue);
                    callback();
                    return void 0;
                }
                if(fn) {
                    if(direction === 'in') {
                        var _max = Math.abs(targetValue-1);
                        this._applyFadeValue(Math.max(process.value === 1 ? _max : 0, _max)); // default max
                    } else if(direction === 'out') {
                        this._applyFadeValue(Math.min(process.value, Math.abs(targetValue-1)));
                    }
                }

                gainNode.gain.linearRampToValueAtTime(targetValue, _webAudio.currentTime + (fadeTime / 1000));
                process.fadeEndTimer = window.setTimeout(callback, fadeTime);
            };

            Playback.prototype.abortFade = function() {
                if(!this.getWebAudioState()) {
                    return void 0;
                }
                var process = this._process;
                var _webAudio = this._WebAudio.context;
                var gainNode = this._WebAudio.gainNode;
                if(process.fadeEndTimer) {
                    gainNode.gain.cancelScheduledValues(_webAudio.currentTime);
                    window.clearTimeout(process.fadeEndTimer);
                }
                process.fadeEndTimer = null;
                process.direction = null;
                process.value = gainNode.gain.value;
            };

            Playback.prototype._applyFadeValue = function(value, time) {
                var _webAudio = this._WebAudio.context;
                var gainNode = this._WebAudio.gainNode;
                var process = this._process;
                gainNode.gain.setValueAtTime(value, time || _webAudio.currentTime);
                process.value = value;
                return true;
            };

            Playback.prototype._beforeFade = function(fn) {
                var state = this.getWebAudioState();
                if(state === void 0) {
                    if(typeof fn === 'function') {
                        fn();
                    }
                    return void 0;
                }
                if(state) {
                    this.abortFade();
                }
                return null;
            };

            Playback.prototype._registerAudioEvents = function() {
                this._listenTo('play', this._onAudioPlay);
                this._listenTo('pause', this._onAudioPaused);
                this._listenTo('ended', this._onAudioEnded);
                this._listenTo('seeked', this._onAudioSeeked);
                this._listenTo('seeking', this._onAudioSeeking);
                this._listenTo('timeupdate', this._onAudioTimeupdate);
                this._listenTo('play', this._onAudioPlay);
                this._listenTo('playing', this._onAudioPlaying);
                this._listenTo('durationchange', this._onAudioDurationChange);
                this._listenTo('volumechange', this._onAudioVoluemChange);
                this._listenTo('loadedmetadata', this._onAudioLoadedMetadata);
                this._listenTo('loadeddata', this._onAudioLoadedData);
            };

            Playback.prototype._load = function(trackItem) {
                if(trackItem) {
                    var type = trackItem.type;
                    var player = this._Player;
                    var customAudioType = player._customAudioType;
                    if(type && customAudioType) {
                        if(customAudioType.hasOwnProperty(type) && customAudioType[type]) {
                            customAudioType[type](this._audio, trackItem);
                            return true;
                        }
                    }
                    if(trackItem.url) {
                        this._audio.src = trackItem.url;
                        this._audio.load();
                        return true;
                    }
                }

                return false;
            };

            Playback.prototype._handleAudioTimeUpdateEvent = function() {
                if(this.isReady()) {
                    var position = this._getElementPosition();
                    var ui = this._Player._UI;
                    this.onTimeUpdate.dispatch(position);
                    ui.setPosition(position);
                }
                if(this.isPlaying()) {
                    this._checkIsActuallyPlaying();
                }
            };

            Playback.prototype._handleAudioDurationChangeEvent = function() {
                if(this.isReady()) {
                    var duration = this._audio.duration * 1000;
                    var ui = this._Player._UI;
                    this.onDurationChange.dispatch(duration);
                    ui.setDuration(duration);
                }
            };

            Playback.prototype._handleAudioVolumeChangeEvent = function() {
                var mute = this._audio.muted;
                var volume = this._audio.volume;
                var ui = this._Player._UI;
                if(ui.isMuted() !== mute) {
                    ui.setMute(mute);
                }
                if(!mute) {
                    ui.setVolume(volume * 100);
                }
                this.onVolumeChange.dispatch({
                    muted: mute,
                    volume: volume * 100
                });
            };

            Playback.prototype._handleAudioSeekingEvent = function() {
                this.onSeeking.dispatch(this.getPosition());
            };

            Playback.prototype._handleAudioSeekedEvent = function() {
                this.onSeeked.dispatch(this.getPosition());
            };

            Playback.prototype._handleAudioEndedEvent = function() {
                this._actuallyPlayingLastTimeStamp = this._getElementPosition();
                this.onAudioEnded.dispatch(void 0);
            };

            Playback.prototype._handleAudioPlayingEvent = function() {
                var that = this;
                var player = this._Player;
                player._registerMediaSessionHandlers();
                if(this._currentTrackItem) {
                    player._updateMediaSessionMetadata(this._currentTrackItem);
                }
                if(!this.isActuallyPlaying()){
                    this._checkIsActuallyPlaying();
                    this._actuallyPlayingLastTimeStamp = this._getElementPosition();
                    this._actuallyPlayingTimerAttemptCount = 0;
                    if(!this._actuallyPlayingTimerID) {
                        this._actuallyPlayingTimerID = window.setInterval(function(){
                            that._checkIsActuallyPlaying();
                        }, 20);
                    }
                }
                this.onPlaying.dispatch(void 0);
            };

            Playback.prototype._handleAudioPlayEvent = function() {
                var ui = this._Player._UI;
                ui.setUIPaused();
                this.onPlay.dispatch();
            };

            Playback.prototype._handleAudioPausedEvent = function() {
                var ui = this._Player._UI;
                ui.setUIPlaying();
                this.onPaused.dispatch();
                this._actuallyPlaying = false;
            };

            Playback.prototype._handleAudioLoadedDataEvent = function() {
                if(this._seekPosition && this.isReady()) {
                    this._handleElementSeek(this._seekPosition);
                }
                this._handleElementPlay();
            };

            Playback.prototype._handleAudioLoadedMetadataEvent = function() {

            };

            Playback.prototype._checkIsActuallyPlaying = function() {
                if(!this._signalledPlay) {
                    return;
                }
                if(this._actuallyPlayingTimerID !== null && (!this.isPlaying() && ++this._actuallyPlayingTimerAttemptCount > 150)) {
                    this._clearActuallyPlayingTimer();
                }
                if(!this.isDestructed() && !this.isActuallyPlaying() && this.isPlaying() &&
                    this._audio && !this._audio.paused &&
                    this._getElementPosition() !== this._actuallyPlayingLastTimeStamp
                ) {
                    this._clearActuallyPlayingTimer();
                    this._actuallyPlaying = true;
                    if(!this._actuallyPlayingDeferred.isResolved()) {
                        this._actuallyPlayingDeferred.resolve();
                    }
                    if(this._WebAudio) {
                        if(this.getWebAudioState() === null) {
                            this.processFade('in', function() {
                                // fade ended
                            }, this._fadeDuration || FADE_TIME);
                        } else {
                            this.processFade('in');
                        }
                    }
                }
            };

            Playback.prototype._clearActuallyPlayingTimer = function() {
                if(this._actuallyPlayingTimerID !== null) {
                    window.clearInterval(this._actuallyPlayingTimerID);
                    this._actuallyPlayingTimerID = null;
                }
            };

            Playback.prototype._listenToOnce = function(type, callback) {
                var fn = function(data) {
                    callback(data);
                    remove();
                };
                var remove = this._listenTo(type, fn);

                return remove;
            };

            Playback.prototype._listenTo = function(type, callback) {
                var that = this;
                var isRemoved = false;
                var fn = function(evt) {
                    callback(evt);
                };
                var remove = function () {
                    if (!isRemoved) {
                        var idx = that._listeners.indexOf(listener);
                        if(idx > -1) {
                            that._listeners.splice(idx, 1);
                        }
                        that._audio.removeEventListener(type, fn, false);
                        isRemoved = true;
                    }
                };
                var listener = {
                    type: type,
                    callback: callback,
                    remove: remove
                };
                this._listeners.push(listener);
                this._audio.addEventListener(type, fn, false);

                return remove;
            };

            Playback.prototype._removeListeners = function() {
                while(this._listeners.length > 0) {
                    var listener = this._listeners.shift();
                    listener.remove();
                }
            };

            Playback.prototype._getElementPosition = function() {
                return this._audio && this._audio.currentTime && !isNaN(this._audio.currentTime) ? this._audio.currentTime * 1000 : 0;
            };

            Playback.prototype.isReady = function() {
                return !!(!this.isDestructed() &&  this._audio && this._audio.duration && !isNaN(this._audio.duration));
            };

            Playback.prototype.isDestructed = function() {
                return this._destructed;
            };

            Playback.prototype.isActuallyPlaying = function() {
                return this._actuallyPlaying;
            };

            Playback.prototype.getCurrentTrackItem = function() {
                return this._currentTrackItem;
            };

            Playback.prototype._getElementDuration = function() {
                return this._audio && !isNaN(this._audio.duration) && this._audio.duration ? this._audio.duration * 1000 : 0;
            };

            Playback.prototype.getDuration = function() {
                var elementDuration = this._getElementDuration();
                var currentTrackItem = this.getCurrentTrackItem();
                if(elementDuration) {
                    return elementDuration;
                }
                if(currentTrackItem && currentTrackItem.duration) {
                    return currentTrackItem.duration;
                }

                return 0;
            };

            Playback.prototype.getPosition = function() {
                return this._getElementPosition();
            };

            Playback.prototype._handleElementPlay = function() {
                if(this._playDeferred && !this._playDeferred.isResolved()) {
                    var that = this;
                    var audio = this._audio;
                    if(audio.paused) {
                        var promise = audio.play();
                        var activeWebAudio = this._activateWebAudio();
                        if(promise) {
                            promise.then(function(){
                                that._playDeferred.resolve({ActuallyPlayingPromise: that._actuallyPlayingDeferred.promise});
                            })['catch'](function(err){
                                activeWebAudio.abort();
                                if(err.name === "AbortError") {
                                    that._playDeferred.resolve({ActuallyPlayingPromise: that._actuallyPlayingDeferred.promise});
                                } else {
                                    that._playDeferred.reject(err);
                                }
                            });
                        } else {
                            this._playDeferred.resolve({ActuallyPlayingPromise: that._actuallyPlayingDeferred.promise});
                        }
                    } else {
                        if(this.isActuallyPlaying()) {
                            this._playDeferred.resolve({ActuallyPlayingPromise: Promise.resolve()});
                        } else if(this._actuallyPlayingDeferred && !this._actuallyPlayingDeferred.isResolved()) {
                            this._playDeferred.resolve({ActuallyPlayingPromise: that._actuallyPlayingDeferred.promise});
                        } else {
                            throw new Error("Unexpected Error");
                        }
                    }
                }
            };

            Playback.prototype._handleElementPause = function() {
                var that = this;
                this._actuallyPlayingLastTimeStamp = this._getElementPosition();
                this._actuallyPlaying = false;
                this._signalledPlay = false;
                if(this._WebAudio) {
                    this.processFade('out', function() {
                        that._audio.pause();
                    }, this._fadeDuration || FADE_TIME);
                } else {
                    if(!this._audio.paused) {
                        this._audio.pause();
                    }
                }
            };

            Playback.prototype._handleElementSeek = function(position) {
                var that = this;
                this._audio.currentTime = position / 1000;
                this._listenToOnce('seeked', function() {
                    that._seekDeferred.resolve();
                });
            };

            Playback.prototype.play = function() {
                if(this._actuallyPlaying){
                    return Promise.resolve(Promise.resolve());
                } else if(this.isPlaying() && this._actuallyPlayingDeferred && !this._actuallyPlayingDeferred.isResolved()) {
                    return Promise.resolve(this._actuallyPlayingDeferred.promise);
                }

                this._signalledPlay = true;
                this._actuallyPlaying = false;
                if(!this._playDeferred || this._playDeferred.isResolved()) {
                    this._playDeferred = makeDeferred();
                    if(!this._actuallyPlayingDeferred || this._actuallyPlayingDeferred.isResolved()) {
                        this._clearActuallyPlayingTimer();
                        this._actuallyPlayingDeferred = makeDeferred();
                    }
                } else {
                    return this._playDeferred;
                }
                if(this.isReady()) {
                    this._handleElementPlay();
                }
                this._playDeferred.promise['catch'](function(e){
                    if(e && e instanceof Error) {
                        console.error(e);
                    }
                });
                this._actuallyPlayingDeferred.promise['catch'](function(e){
                    if(e && e instanceof Error) {
                        console.error(e);
                    }
                });

                return this._playDeferred.promise;
            };

            Playback.prototype.pause = function() {
                if(this._playDeferred && !this._playDeferred.isResolved()) {
                    this._playDeferred.reject({
                        type: 'paused',
                        error: null
                    });
                }
                if(this._actuallyPlayingDeferred && !this._actuallyPlayingDeferred.isResolved()) {
                    this._actuallyPlayingDeferred.reject({
                        type: 'paused',
                        error: null
                    });
                }
                this._clearActuallyPlayingTimer();
                this._handleElementPause();
            };

            Playback.prototype.isPlaying = function() {
                return this.isReady() && !this._audio.paused;
            };

            Playback.prototype.isSignalledPlay = function() {
                return this._signalledPlay;
            };

            Playback.prototype.seek = function(position) {
                if(this._seekDeferred && !this._seekDeferred.isResolved()) {
                    this._seekDeferred.reject({
                        type: 'rejected',
                        position: position,
                        error: null
                    });
                }
                this._seekDeferred = makeDeferred();
                var promise = this._seekDeferred.promise;
                promise['catch'](function(err){
                    if(err instanceof Error){
                        console.error(err);
                    }
                });

                if(!this.isReady()) {
                    this._seekPosition = position;
                } else {
                    this._handleElementSeek(position);
                }

                return promise;
            };

            Playback.prototype.setVolume = function(volume) {
                this._audio.volume = volume / 100;
            };

            Playback.prototype.setMute = function(mute) {
                this._audio.muted = mute;
            };

            Playback.prototype.setTrack = function(trackItem) {
                if(this._playDeferred && !this._playDeferred.isResolved()) {
                    this._playDeferred.reject({
                        type: 'aborted',
                        error: null,
                        TrackItem: trackItem
                    });
                    this._playDeferred = null;
                }
                if(this._actuallyPlayingDeferred && !this._actuallyPlayingDeferred.isResolved()) {
                    this._actuallyPlayingDeferred.reject({
                        type: 'aborted',
                        trackItem: trackItem,
                        error: null
                    });
                }

                this._actuallyPlaying = false;
                var playlist = this._Player._Playlist;
                playlist.provideCurrentTrackItem(trackItem);
                this._currentTrackItem = trackItem;
                this._seekPosition = null;
                this._signalledPlay = false;
                this._load(trackItem);
            };

            Playback.prototype.destruct = function() {
                if(!this.isDestructed()) {
                    this._removeListeners();
                    this._destructed = true;
                }
            };

            return Playback;
        }();

        var Playlist = function() {

            var MAX_PLAYING_TRACK_HISTORY_COUNT = 1000;

            function getDefaultSongRequest(trackItem, type) {
                return {
                    promise: Promise.resolve(trackItem),
                    abort: function() {
                        return void 0;
                    },
                    isResolved: function() {
                        return true;
                    },
                    getType: function() {
                        return type || null;
                    }
                };
            }

            var PlaylistManager = function() {
                function PlaylistManager(playlist) {
                    this._destructed = false;
                    this._playingTrackHistory = [];
                    this._playlist = playlist;
                    this._lastTrackItem = null;
                    this._lastHistoryItemIndex = null;
                    this._trackMode = null;
                }

                PlaylistManager.prototype.buildPlaylist = function() {
                    return null;
                };

                PlaylistManager.prototype.provideCurrentTrackItem = function(trackItem) {
                    if(!this._lastTrackItem) {
                        this._lastTrackItem = trackItem;
                    } else if(trackItem && this._lastTrackItem !== trackItem) {
                        this._lastTrackItem = trackItem;
                        while(this._playingTrackHistory.length > MAX_PLAYING_TRACK_HISTORY_COUNT) {
                            if(this._lastHistoryItemIndex !== null) {
                                this._lastHistoryItemIndex--;
                                if(this._lastHistoryItemIndex < 0 ) {
                                    this._lastHistoryItemIndex = null;
                                }
                            }
                            this._playingTrackHistory.shift();
                        }
                        var idx = this._playingTrackHistory.indexOf(this._lastTrackItem);
                        if(idx > -1) {
                            this._playingTrackHistory.splice(idx, 1);
                        }
                        this._playingTrackHistory.push(this._lastTrackItem);
                    }
                };

                PlaylistManager.prototype.isDestructed = function() {
                    return this._destructed;
                };

                PlaylistManager.prototype.isRandom = function() {
                    return null;
                };

                PlaylistManager.prototype.getPreviousTrack = function() {
                    return null;
                };

                PlaylistManager.prototype.getNextTrack = function() {
                    return null;
                };

                PlaylistManager.prototype.setRandom = function() {
                    return null;
                };

                PlaylistManager.prototype.resetSequence = function() {
                    return null;
                };

                PlaylistManager.prototype.getPreviousTrackFromHistory = function() {
                    var lastIndex = -1;
                    if(this._lastHistoryItemIndex === null && this._lastTrackItem) {
                        lastIndex = this._playingTrackHistory.indexOf(this._lastTrackItem);
                    }
                    if(lastIndex === -1) {
                        lastIndex = this._lastHistoryItemIndex === null ? this._playingTrackHistory.length : this._lastHistoryItemIndex;
                    }
                    var trackItem = null;
                    this._lastHistoryItemIndex = lastIndex >= 0 ? (--lastIndex) : lastIndex;
                    if(this._lastHistoryItemIndex >= 0) {
                        trackItem = this._playingTrackHistory[lastIndex] || null;
                    }

                    return getDefaultSongRequest(trackItem, 'previous_track_from_history');
                };

                PlaylistManager.prototype.addTrackItems = function(trackItems) {
                    var pushedTrack = [];
                    while(trackItems.length > 0) {
                        var trackItem = trackItems.shift();
                        var idx = this._playlist.indexOf(trackItem);
                        if(idx === -1) {
                            this._playlist.push(trackItem);
                            pushedTrack.push(trackItem);
                        }
                    }

                    return pushedTrack;
                };

                PlaylistManager.prototype.removeTrackItem = function(trackItem) {
                    if(trackItem) {
                        var idx = this._playlist.indexOf(trackItem);
                        if(idx > -1) {
                            this._playlist.splice(idx, 1);
                            return true;
                        }
                    }

                    return false;
                };

                PlaylistManager.prototype.setTrackMode = function(mode) {
                    return null;
                };

                PlaylistManager.prototype.getTrackMode = function() {
                    return this._trackMode;
                };

                PlaylistManager.prototype.resetSequence = function() {
                    return null;
                };

                PlaylistManager.prototype.getType = function() {
                    return "PLAYLIST_MANAGER";
                };

                PlaylistManager.prototype.destruct = function() {
                    if(!this.isDestructed()) {
                        this._destructed = true;
                    }
                };

                return PlaylistManager;

            }();

            var RandomPlaylistManager = function() {
                function RandomPlaylistManager(playlist, mode) {
                    var that = PlaylistManager.apply(this, arguments) || this;
                    that._pickedPlaylist = [];
                    that._standByPlaylist = this.buildPlaylist(playlist.slice());
                    that._trackMode = mode;
                }

                __extend(RandomPlaylistManager, PlaylistManager);

                RandomPlaylistManager.prototype.buildPlaylist = function(playlist) {
                    var counter = playlist.length;
                    while (counter > 0) {
                        var index = Math.floor(Math.random() * counter);
                        counter--;
                        var temp = playlist[counter];
                        playlist[counter] = playlist[index];
                        playlist[index] = temp;
                    }

                    return playlist;
                };

                RandomPlaylistManager.prototype.provideCurrentTrackItem = function(trackItem) {
                    var standByTrackIndex = this._standByPlaylist.indexOf(trackItem);
                    var pickedTrackIndex = this._pickedPlaylist.indexOf(trackItem);
                    if(standByTrackIndex > -1) {
                        this._standByPlaylist.splice(standByTrackIndex, 1);
                    } else if(pickedTrackIndex > -1) {
                        this._pickedPlaylist.splice(pickedTrackIndex, 1);
                    }
                    if(standByTrackIndex > -1 || pickedTrackIndex > -1) {
                        this._pickedPlaylist.push(trackItem);
                    }

                    PlaylistManager.prototype.provideCurrentTrackItem.call(this, trackItem);
                };

                RandomPlaylistManager.prototype.resetSequence = function() {
                    this._lastTrackItem = null;
                    this._pickedPlaylist = [];
                    this._standByPlaylist = this.buildPlaylist(this._playlist.slice());
                };

                RandomPlaylistManager.prototype.getPreviousTrackItem = function() {
                    return this.getPreviousTrackFromHistory();
                };

                RandomPlaylistManager.prototype.getNextTrackItem = function(fromEndedEvent) {
                    if(fromEndedEvent && this._lastTrackItem && this._trackMode === TrackMode.REPEAT_TRACK) {
                        return getDefaultSongRequest(this._currentTrackItem);
                    }
                    if(!this._standByPlaylist.length && (!fromEndedEvent || this.getTrackMode() === TrackMode.REPEAT_LIST)) {
                        this.resetSequence();
                    }

                    var shiftTrackItem = this._standByPlaylist.shift();
                    if(shiftTrackItem) {
                        this._pickedPlaylist.push(shiftTrackItem);
                    }
                    this._lastHistoryItemIndex = null;
                    return getDefaultSongRequest( shiftTrackItem || null);
                };

                RandomPlaylistManager.prototype.addTrackItems = function(trackItems) {
                    var jobCompleted = PlaylistManager.prototype.addTrackItems.call(this, trackItems);
                    if(jobCompleted) {
                        this._standByPlaylist = this._standByPlaylist.concat(jobCompleted);
                        this.buildPlaylist(this._standByPlaylist);
                    }
                };

                RandomPlaylistManager.prototype.removeTrackItem = function(trackItem) {
                    PlaylistManager.prototype.removeTrackItem.call(this, trackItem);
                    var pickedTrackItemIndex = this._pickedPlaylist.indexOf(trackItem);
                    var standByTrackItemIndex = this._standByPlaylist.indexOf(trackItem);
                    if(pickedTrackItemIndex > -1) {
                        this._pickedPlaylist.splice(pickedTrackItemIndex, 1);
                    }
                    if(standByTrackItemIndex > -1) {
                        this._standByPlaylist.splice(standByTrackItemIndex, 1);
                    }
                };

                RandomPlaylistManager.prototype.setTrackMode = function(mode) {
                    this._trackMode = mode;
                };

                RandomPlaylistManager.prototype.getType = function() {
                    return "RANDOM_PLAYLIST_MANAGER";
                };

                RandomPlaylistManager.prototype.destruct = function() {
                    if(!this.isDestructed()) {
                        PlaylistManager.prototype.destruct.call(this);
                        this._pickedPlaylist = [];
                        this._standByPlaylist = [];
                    }
                };

                return RandomPlaylistManager;
            }();

            function Playlist(player, config) {
                var playlist = config.playlist;
                var trackMode = config.mode;
                var handlers = config.handlers;

                this._player = player;
                this._destructed = false;
                this._playlist = this.constructor.parse(playlist);
                this._trackMode = TrackMode[trackMode] !== void 0 ? trackMode : TrackMode.REPEAT_LIST;
                this._CustomPlaylist = handlers.CustomPlaylist ? new handlers.CustomPlaylist(player) : null;
                this._currentTrackItem = null;
                this._PlaylistManager = null;
                this._random = config.random;

                this.setTrackMode(this._trackMode);
                this.setRandom(this._random);
            }

            Playlist.PlaylistManager = PlaylistManager;

            Playlist.RandomPlaylistManager = RandomPlaylistManager;

            Playlist.getDefaultSongRequest = getDefaultSongRequest;

            Playlist.parse = function(playlistArr) {
                if(playlistArr && playlistArr.length > 0) {
                    return playlistArr.map(function(eachPlaylist){
                        if(eachPlaylist) {
                            return new TrackItem({
                                title: eachPlaylist.title,
                                artist: eachPlaylist.artist,
                                album: eachPlaylist.album,
                                albumArt: eachPlaylist.albumArt || eachPlaylist.cover,
                                duration: eachPlaylist.duration,
                                url: eachPlaylist.url,
                                type: eachPlaylist.type,
                                lrcType: eachPlaylist.lrcType,
                                lrc: eachPlaylist.lrc,
                                allowRemove: eachPlaylist.allowRemove
                            }, eachPlaylist.description);
                        } else {
                            return null;
                        }
                    }).filter(function(playlist){
                        return playlist !== null;
                    });
                }

                return [];
            };

            Playlist.prototype.getPlaylist = function() {
                return this._playlist;
            };

            Playlist.prototype.getPreviousTrackItem = function() {
                if(this._PlaylistManager) {
                    return this._PlaylistManager.getPreviousTrackItem();
                }

                return this._getPreviousTrackItem();
            };

            Playlist.prototype._getPreviousTrackItem = function() {
                var trackItemCount = this.getTrackItemCount();
                if(trackItemCount) {
                    var currentTrackIdx = this.getTrackItemIndex(this._currentTrackItem);
                    if(currentTrackIdx === -1 || !this._currentTrackItem || currentTrackIdx === 0) {
                        var lastTrackItem = this.getTrackItemByIndex(trackItemCount-1);
                        return getDefaultSongRequest(lastTrackItem);
                    } else {
                        var prevIdx = currentTrackIdx-1;
                        var prevTrackItem = this.getTrackItemByIndex(prevIdx);
                        if(prevTrackItem) {
                            return getDefaultSongRequest(prevTrackItem);
                        }
                    }
                }

                return getDefaultSongRequest(null);
            };

            Playlist.prototype.getNextTrackItem = function(fromEndedEvent) {
                if(this._PlaylistManager) {
                    return this._PlaylistManager.getNextTrackItem(fromEndedEvent);
                }

                return this._getNextTrackItem(fromEndedEvent);
            };

            Playlist.prototype._getNextTrackItem = function(fromEndedEvent) {
                if(fromEndedEvent && this._currentTrackItem && this._trackMode === TrackMode.REPEAT_TRACK) {
                    return getDefaultSongRequest(this._currentTrackItem);
                }
                var trackItemCount = this.getTrackItemCount();
                if(trackItemCount) {
                    var currentTrackIdx = this.getTrackItemIndex(this._currentTrackItem);
                    if(!this._currentTrackItem || currentTrackIdx === -1 || ((!fromEndedEvent || this._trackMode === TrackMode.REPEAT_LIST) && currentTrackIdx+1 >= trackItemCount)) {
                        var firstTrackItem = this.getTrackItemByIndex(0);
                        if(firstTrackItem) {
                            return getDefaultSongRequest(firstTrackItem);
                        }
                    } else {
                        var nextIdx = currentTrackIdx+1;
                        var nextTrackItem = this.getTrackItemByIndex(nextIdx);
                        if(nextTrackItem) {
                            return getDefaultSongRequest(nextTrackItem);
                        }
                    }
                }

                return getDefaultSongRequest(null);
            };

            Playlist.prototype.getTrackItemIndex = function(trackItem) {
                if(!trackItem) {
                    return -1;
                }
                return this._playlist.indexOf(trackItem);
            };

            Playlist.prototype.provideCurrentTrackItem = function(trackItem) {
                this._currentTrackItem = trackItem;
                if(this._PlaylistManager) {
                    this._PlaylistManager.provideCurrentTrackItem(this._currentTrackItem);
                }
            };

            Playlist.prototype.getTrackItemIndexByTrackID = function(trackID) {
                if(!trackID) {
                    return -1;
                }
                return this._playlist.findIndex(function(each){
                    return each.id == trackID;
                });
            };

            Playlist.prototype.getTrackItem = function(id) {
                return this._playlist.find(function(trackItem){
                    return trackItem.id == id;
                });
            };

            Playlist.prototype.getTrackItemByIndex = function(idx) {
                var playlist = this.getPlaylist();
                if(idx !== void 0 && playlist.length > 0 && playlist[idx]) {
                    return playlist[idx];
                }

                return null;
            };

            Playlist.prototype.getTrackItemCount = function() {
                return this._playlist.length;
            };

            Playlist.prototype.isRandom = function() {
                return this._random;
            };

            Playlist.prototype.setTrackMode = function(mode) {
                if(TrackMode[mode] !== void 0) {
                    this._trackMode = mode;
                    if(TrackMode.CUSTOM_LIST === mode) {
                        if(this._PlaylistManager && this._CustomPlaylist && this._PlaylistManager.constructor !== this._CustomPlaylist.constructor) {
                            this._PlaylistManager.destruct();
                        }
                        this._PlaylistManager = this._CustomPlaylist;
                        this._PlaylistManager.setRandom(this.isRandom());
                    } else {
                        if(this._PlaylistManager && this._CustomPlaylist && this._PlaylistManager === this._CustomPlaylist) {
                            this._PlaylistManager = null;
                            if(this.isRandom()) {
                                this.setRandom(true);
                            }
                        }
                        if(this._PlaylistManager) {
                            this._PlaylistManager.setTrackMode(mode);
                        }
                    }
                }
            };

            Playlist.prototype.getTrackMode = function() {
                return this._trackMode;
            };

            Playlist.prototype.setRandom = function(random) {
                if(this._trackMode === TrackMode.CUSTOM_LIST) {
                    if(this._PlaylistManager) {
                        this._PlaylistManager.setRandom(random);
                    }
                } else {
                    if(random) {
                        this._PlaylistManager = new RandomPlaylistManager(this._playlist, this.getTrackMode());
                        if(this._currentTrackItem) {
                            this._PlaylistManager.provideCurrentTrackItem(this._currentTrackItem);
                        }
                    } else {
                        if(this._PlaylistManager) {
                            this._PlaylistManager.destruct();
                        }
                        this._PlaylistManager = null;
                    }
                }
                this._random = random;
            };

            Playlist.prototype.addTrackItems = function(trackItems) {
                var that = this;
                var player = this._player;
                var ui = player._UI;
                var parsedPlaylist = this.constructor.parse(trackItems);
                parsedPlaylist.forEach(function(trackItem) {
                    that._playlist.push(trackItem);
                });
                if(this._PlaylistManager) {
                    this._PlaylistManager.addTrackItems(trackItems);
                }
                ui.addTrackItems(parsedPlaylist);

                return parsedPlaylist;
            };

            Playlist.prototype.removeTrackItem = function(trackItem) {
                var idx = this._playlist.indexOf(trackItem);
                var trackItem = this.getTrackItemByIndex(idx);
                if(idx>-1) {
                    this._playlist.splice(idx, 1);
                    if(this._PlaylistManager) {
                        this._PlaylistManager.removeTrackItem(trackItem);
                    }

                    return true;
                }

                return false;
            };

            Playlist.prototype.resetSequence = function() {
                if(this._PlaylistManager) {
                    return this._PlaylistManager.resetSequence();
                }
                this._currentTrackItem = null;
            };

            Playlist.prototype.isDestructed = function() {
                return this._destructed;
            };

            Playlist.prototype.destruct = function() {
                if(!this.isDestructed()) {
                    this._destructed = true;
                }
            };

            return Playlist;
        }();

        var Controller = function() {
            function Controller(player) {
                if(!player) {
                    throw new Error('Player must be extsts.');
                }
                this._currentTrackItem = null;
                this._subscribers = [];
                this._Player = player;
                this._Playback = this._Player._Playback;
                this._Playlist = this._Player._Playlist;
                this._UI = this._Player._UI;
                this._Lyric = this._Player._Lyric;
                this._destructed = false;
                this._trackRequestJob = null;

                this._init();
            };

            Controller.prototype._init = function() {
                var that = this;
                var player = this._Player;
                var playlist = this._Playlist.getPlaylist();
                that._UI.addTrackItems(playlist);
                this._registerUIListeners();
                this.resetPlaylistSequence(this._Player._autoplay);
            };

            Controller.prototype._registerUIListeners = function() {
                this._subscribers.push(this._UI.onTrackItemClick.subscribe(this._onTrackItemClick.bind(this)));
                this._subscribers.push(this._UI.onModeButtonClick.subscribe(this._handleModeButtonClick.bind(this)));
                this._subscribers.push(this._UI.onPreviousButtonClick.subscribe(this._handlePreviousButtonClick.bind(this)));
                this._subscribers.push(this._UI.onNextButtonClick.subscribe(this._handleNextButtonClick.bind(this)));
                this._subscribers.push(this._UI.onRandomButtonClick.subscribe(this._handleRandomButtonClick.bind(this)));

                this._subscribers.push(this._Playback.onAudioEnded.subscribe(this._handleAudioEnded.bind(this)));
            };

            Controller.prototype._onTrackItemClick = function(trackItem) {
                if(trackItem && this._currentTrackItem === trackItem) {
                    if(this._Playback.isPlaying()) {
                        this._Playback.pause();
                    } else {
                        this._Playback.play();
                    }

                    return;
                }

                this._abortTrackRequestJob();
                this._currentTrackItem = trackItem;
                this.switchLyric(trackItem);
                this._Playback.setTrack(trackItem);
                this._Playback.play();
            };

            Controller.prototype._handlePreviousButtonClick = function() {
                var playback = this._Playback;
                this.skipBackwardTrack(playback.isPlaying() || playback.isSignalledPlay());
            };

            Controller.prototype._handleNextButtonClick = function() {
                var playback = this._Playback;
                this.skipForwardTrack(playback.isPlaying() || playback.isSignalledPlay());
            };

            Controller.prototype.setCurrentTrackItem = function(trackItem, play) {
                if(trackItem) {
                    this._currentTrackItem = trackItem;
                    this._UI.setCurrentTrackItem(trackItem);
                    this._Playback.setTrack(trackItem);
                    this.switchLyric(trackItem);
                    if(play) {
                        this._Playback.play();
                    }
                }
            };

            Controller.prototype._handleRandomButtonClick = function(random) {
                this._Player._random = random;
                this._Playlist.setRandom(random);
            };

            Controller.prototype._handleModeButtonClick = function(mode) {
                this._Player._mode = mode;
                this._Playlist.setTrackMode(mode);
            };

            Controller.prototype._handleAudioEnded = function() {
                this._abortTrackRequestJob();
                this._trackRequestJob = this._Playlist.getNextTrackItem(true);
                var that = this;
                var promise = this._trackRequestJob.promise;
                promise.then(function(data) {
                    if(data) {
                        that.setCurrentTrackItem(data, true);
                    } else if(that._Player._mode !== TrackMode.CUSTOM_LIST) {
                        that.resetPlaylistSequence();
                    }
                });
            };

            Controller.prototype.resetPlaylistSequence = function(play) {
                var that = this;
                var playlist = this._Playlist;
                this._abortTrackRequestJob();
                playlist.resetSequence();
                this._trackRequestJob = this._Playlist.getNextTrackItem();
                var promise = this._trackRequestJob.promise;
                promise.then(function(data){
                    that.setCurrentTrackItem(data, play);
                });
            };

            Controller.prototype._abortTrackRequestJob = function() {
                if(this._trackRequestJob && !this._trackRequestJob.isResolved()) {
                    this._trackRequestJob.abort();
                }
                this._trackRequestJob = null;
            };

            Controller.prototype.switchLyric = function(trackItem) {
                if(trackItem && this._Lyric) {
                    this._Lyric.provideCurrentTrackItem(trackItem);
                }
            };

            Controller.prototype.removeSubscribers = function() {
                while(this._subscribers.length > 0) {
                    var subscriber = this._subscribers.shift();
                    subscriber.remove();
                }
            };

            Controller.prototype.skipBackwardTrack = function(play) {
                this._abortTrackRequestJob();
                this._trackRequestJob = this._Playlist.getPreviousTrackItem();
                var that = this;
                var promise = this._trackRequestJob.promise;
                promise.then(function(data){
                    that.setCurrentTrackItem(data, play);
                });
            };

            Controller.prototype.skipForwardTrack = function(play) {
                this._abortTrackRequestJob();
                this._trackRequestJob = this._Playlist.getNextTrackItem();
                var that = this;
                var promise = this._trackRequestJob.promise;
                promise.then(function(data){
                    that.setCurrentTrackItem(data, play);
                });
            };

            Controller.prototype.pause = function() {
                this._Playback.pause();
            };

            Controller.prototype.isDestructed = function() {
                return this._destructed;
            };

            Controller.prototype.destruct = function() {
                if(!this.isDestructed()) {
                    this.removeSubscribers();
                    this._destructed = true;
                }
            };

            return Controller;

        }();

        var Lyric = function() {
            function getLyricObj(text, wait) {
                return {
                    text:text,
                    wait: wait || false
                };
            }

            function Lyric(player, config) {
                var messages = config.messages;
                this._player = player;
                this._destructed = false;
                this._currentTrackItem = null;
                this._LrcInitDeferred = null;
                this._lyric = null;
                this._lastLyricIndex = null;
                this._listeners = [];
                this._loadingLyric = messages.loadingLyric || "Loading...";
                this._notFoundLyric = messages.notFoundLyric || "";
                this._firstLyric = null;
                this._secondLyric = null;
                this._lyricUpdateTimerID = null;
                this._singleLineUpdateTimerID = null;
                this._singleLineMode = false;
                this._evenLine = false;
                this._recentLyricOffset = null;
            }

            Lyric.prototype._onTimeupdateHandler = function(position) {
                this._update(position);
            };

            Lyric.prototype._onSeekedHandler = function(position) {
                this._lastLyricIndex = null;
                this._recentLyricOffset = null;
                this._evenLine = false;
                this._clearLyricUpdateTimer();
                this._update(position, true);
            };

            Lyric.prototype._onPausedHandler = function() {
                this._clearLyricUpdateTimer();
            };

            Lyric.prototype._getSecondLyric = function() {
                if(this.isLyricExist()) {
                    if(this._secondLyric === null) {
                        this._secondLyric = this._getLyricByOffset(1);
                    }

                    return this._secondLyric;
                }

                return null;
            };

            Lyric.prototype._getFirstLyric = function() {
                if(this.isLyricExist()) {
                    if(this._firstLyric === null) {
                        this._firstLyric = this._getLyricByOffset(0);
                    }

                    return this._firstLyric;
                }

                return null;
            };

            Lyric.prototype._getLyricByOffset = function(offset) {
                var lyric = [];
                var lrcOffset = -1;
                var lastLyricPos = null;
                for(var i=0; i<this._lyric.length; i++) {
                    var thisLyric = this._lyric[i];
                    if(lastLyricPos !== thisLyric[0]) {
                        lastLyricPos = thisLyric[0];
                        lrcOffset++;
                    }
                    if(lrcOffset>offset) {
                        break;
                    }
                    if(lrcOffset === offset) {
                        lyric.push(thisLyric);
                    }
                }

                return lyric;
            };

            Lyric.prototype._update = function(position, fromSeekedEvent) {
                var player = this._player;
                var playback = player._Playback;
                var actuallyPosition = playback.getPosition();
                if(position === void 0) {
                    position = actuallyPosition;
                }
                if(isNaN(position) || position < 0) {
                    position = 0;
                }

                var that = this;
                var secondLyric = this._getSecondLyric();
                var secondLyricTimeStamp = null;
                if(secondLyric && secondLyric.length) {
                    secondLyricTimeStamp = secondLyric[0][0];
                }
                var firstLyric = this._getFirstLyric();
                if(this._lastLyricIndex === null && firstLyric && firstLyric.length > 0) {
                    var firstLyricTimeStamp = firstLyric[0][0];
                    if(secondLyricTimeStamp && position < secondLyricTimeStamp) {
                        if(this._isSingleLineLyric()) {
                            if(position < firstLyricTimeStamp) {
                                this._singleLineUpdate(null, firstLyric[0], secondLyric[0], null, position);
                            } else {
                                this._singleLineUpdate(firstLyric[0], secondLyric[0], null, null, position);
                            }
                        } else {
                            this.updateLyric(firstLyric.map(function(lyric){
                                return getLyricObj(lyric[1], firstLyricTimeStamp > position);
                            }));
                        }
                        this._recentLyricOffset = null;
                        if(position < firstLyricTimeStamp) {
                            this.focusCurrentLineInExtendedLyric();
                            this._lastLyricIndex = -1;
                        } else {
                            var firstLyricOffsets = [];
                            firstLyric.forEach(function(each, idx){
                                firstLyricOffsets.push(idx);
                            });
                            this.focusCurrentLineInExtendedLyric(firstLyricOffsets);
                            this._lastLyricIndex = firstLyricOffsets.length-1;
                        }

                        return;
                    }
                }
                if(this._lyric && this._lyric.length > 0) {
                    if(this._lastLyricIndex === null) {
                        this._lastLyricIndex = -1;
                    }
                    var lyric = [];
                    var lyricIndex = [];
                    var lyricTimestamp = null;
                    for(var i=this._lastLyricIndex+1; i<this._lyric.length; i++) {
                        var thisLyric = this._lyric[i];
                        var timestamp = thisLyric[0];
                        if(position>timestamp) {
                            if(lyricTimestamp !== timestamp) {
                                lyric = [];
                                lyricIndex = [];
                                lyricTimestamp = timestamp;
                            }
                            lyric.push(getLyricObj(thisLyric[1]));
                            lyricIndex.push(i);
                            this._lastLyricIndex = i;
                        } else {
                            break;
                        }
                    }
                    if(lyric.length) {
                        this._recentLyricOffset = lyricIndex;
                        this.focusCurrentLineInExtendedLyric(lyricIndex);
                        var nextLyric = this._lastLyricIndex+1 < this._lyric.length ? this._lyric[this._lastLyricIndex+1] : null;
                        if(playback.isActuallyPlaying() && nextLyric && position < nextLyric[0]) {
                            this._clearLyricUpdateTimer();
                            this._lyricUpdateTimerID = window.setTimeout(function(){
                                that._update(nextLyric[0]+10);
                            }, nextLyric[0]-actuallyPosition);
                        }
                        if(this._isSingleLineLyric()) {
                            var currentLyric = this._lyric[this._lastLyricIndex];
                            var prevLyric = this._lastLyricIndex-1 >=0 ? this._lyric[this._lastLyricIndex-1] : null;
                            this._singleLineUpdate(currentLyric, nextLyric, null, !fromSeekedEvent ? prevLyric : null, position);
                        } else {
                            this.updateLyric(lyric);
                        }
                    }
                }
            };

            Lyric.prototype._isSingleLineLyric = function() {
                return this._singleLineMode;
            };

            Lyric.prototype._singleLineUpdate = function(currentLyric, nextLyric, aboveLyric, prevLyric, currentPosition) {
                this._clearSingleLineTimer();

                //맨 첫 가사
                var that = this;
                var lyric = [];
                if(!currentLyric && nextLyric) {
                    lyric.push(getLyricObj(nextLyric[1], true));
                    if(aboveLyric) {
                        lyric.push(getLyricObj(aboveLyric[1], true));
                    }
                    this._evenLine = !this._evenLine;
                } else if(currentLyric && (nextLyric || prevLyric)) {
                    if(prevLyric) {
                        var isEven = this._evenLine;
                        if(!isEven) {
                            lyric.push(getLyricObj(currentLyric[1], false));
                            lyric.push(getLyricObj(prevLyric[1], true));
                        } else {
                            lyric.push(getLyricObj(prevLyric[1], true));
                            lyric.push(getLyricObj(currentLyric[1], false));
                        }
                        if(nextLyric) {
                            var timeDiff = (nextLyric[0] - currentPosition) / 3;
                            this._singleLineUpdateTimerID = window.setTimeout(function() {
                                var lyric = [];
                                if(!isEven) {
                                    lyric.push(getLyricObj(currentLyric[1], false));
                                    lyric.push(getLyricObj(nextLyric[1], true));
                                } else {
                                    lyric.push(getLyricObj(nextLyric[1], true));
                                    lyric.push(getLyricObj(currentLyric[1], false));
                                }
                                that.updateLyric(lyric);
                            }, timeDiff);
                        }
                    } else if(nextLyric) {
                        if(!isEven) {
                            lyric.push(getLyricObj(currentLyric[1], false));
                            lyric.push(getLyricObj(nextLyric[1], true));
                        } else {
                            lyric.push(getLyricObj(nextLyric[1], true));
                            lyric.push(getLyricObj(currentLyric[1], false));
                        }
                    }
                } else {
                    lyric.push(getLyricObj(currentLyric[1], false));
                }

                this._evenLine = !this._evenLine;
                this.updateLyric(lyric);
            };

            Lyric.prototype._clearSingleLineTimer = function() {
                if(this._singleLineUpdateTimerID !== null) {
                    window.clearTimeout(this._singleLineUpdateTimerID);
                    this._singleLineUpdateTimerID = null;
                }
            };

            Lyric.prototype._clearLyricUpdateTimer = function() {
                if(this._lyricUpdateTimerID !== null) {
                    window.clearTimeout(this._lyricUpdateTimerID);
                    this._lyricUpdateTimerID = null;
                }
            };

            Lyric.prototype._connectEventHandler = function() {
                var player = this._player;
                var playback = player._Playback;
                this._disconnectEventHandler();
                var timeupdateListener = playback.onTimeUpdate.subscribe(this._onTimeupdateHandler.bind(this));
                var seekedListener = playback.onSeeked.subscribe(this._onSeekedHandler.bind(this));
                var pausedListener = playback.onPaused.subscribe(this._onPausedHandler.bind(this));
                this._listeners.push(timeupdateListener);
                this._listeners.push(seekedListener);
                this._listeners.push(pausedListener);
            };

            Lyric.prototype._disconnectEventHandler = function() {
                while(this._listeners.length) {
                    var listener = this._listeners.shift();
                    listener.remove();
                }
            };

            Lyric.prototype.updateLyric = function(lrcArr) {
                var player = this._player;
                var ui = player._UI;
                ui.updateLyric(lrcArr && lrcArr.length > 0 ? lrcArr : "");
            };

            Lyric.prototype.showNoticeForExtendedLyric = function(noticeArr) {
                var player = this._player;
                var ui = player._UI;
                ui.updateExtendedLyric(noticeArr, true);
            };

            Lyric.prototype.focusCurrentLineInExtendedLyric = function(offsets) {
                var player = this._player;
                var ui = player._UI;
                ui.focusExtendedLyricLine(offsets);
            };

            Lyric.prototype.provideLyricToExtendedLyric = function(lyric) {
                var player = this._player;
                var ui = player._UI;
                ui.updateExtendedLyric(lyric);
            };

            Lyric.prototype.showLoadingBanner = function() {
                this.updateLyric([getLyricObj(this._loadingLyric, true)]);
                this.showNoticeForExtendedLyric([this._loadingLyric]);
            };

            Lyric.prototype.showNotFoundBanner = function() {
                this.updateLyric([getLyricObj(this._notFoundLyric, true)]);
                this.showNoticeForExtendedLyric([this._notFoundLyric]);
            };

            Lyric.prototype.abortLrcInitDeferred = function(type) {
                if(this._LrcInitDeferred && !this._LrcInitDeferred.isResolved()) {
                    this._LrcInitDeferred.reject({
                        type: type || 'abort'
                    });
                    this._LrcInitDeferred = null;
                }
            };

            Lyric.prototype.isLyricExist = function() {
                return this._lyric && this._lyric.length > 0;
            };

            Lyric.prototype.getRecentLyricOffset = function() {
                return this._recentLyricOffset;
            };

            Lyric.prototype.provideCurrentTrackItem = function(trackItem) {
                var that = this;
                this.abortLrcInitDeferred();
                this._clearSingleLineTimer();
                this._disconnectEventHandler();
                this._clearLyricUpdateTimer();
                this._lyric = null;
                this._lastLyricIndex = null;
                this._recentLyricOffset = null;
                this._firstLyric = null;
                this._secondLyric = null;
                this._singleLineMode = false;
                this._evenLine = false;
                var lrc = trackItem._Lrc ? trackItem._Lrc : null;
                if(!lrc && trackItem && trackItem.lrc) {
                    lrc = new Lrc(trackItem);
                    trackItem._Lrc = lrc;
                }
                if(lrc) {
                    this._LrcInitDeferred = makeDeferred();
                    var promise = this._LrcInitDeferred.promise;
                    if(!lrc.isLoaded()) {
                        this.showLoadingBanner();
                    }
                    lrc.getLyric().then(function(lyric){
                        that._LrcInitDeferred.resolve(lyric);
                    })['catch'](function(e){
                        that._LrcInitDeferred.reject(e);
                        if(e instanceof Error) {
                            console.error(e);
                        }
                    });
                    promise.then(function(lyric){
                        if(lyric && lyric.length > 0) {
                            that._connectEventHandler();
                            that._lyric = lyric;
                            that.provideLyricToExtendedLyric(that._lyric);
                            that._singleLineMode = lrc.isSingleLineLyric();
                            that._update();
                        } else {
                            that.showNotFoundBanner();
                        }
                    })['catch'](function(e) {
                        if(e instanceof Error) {
                            console.error(e);
                        }
                    });

                    return promise;
                }
                this.showNotFoundBanner();

                return null;
            };

            Lyric.prototype.isDestructed = function() {
                return this._destructed;
            };

            Lyric.prototype.destruct = function() {
                if(!this.isDestructed()) {
                    this._clearSingleLineTimer();
                    this._clearLyricUpdateTimer();
                    this._disconnectEventHandler();
                    this.abortLrcInitDeferred('destructed');
                    this._recentLyricOffset = null;
                    this._destructed = true;
                }
            };

            return Lyric;

        }();

        var Lrc = function() {
            function Lrc(trackItem) {
                this._TrackItem = trackItem;
                this._lrcType = trackItem.lrcType;
                this._parsedLyric = null;
                this._loaded = false;
                this._destructed = false;
                this._requestingLrcJob = null;
                this._singleLineLyric = null;
            }

            // Reference of APlayer
            Lrc.parse = function(lrcText) {
                if(!lrcText) {
                    return null;
                }
                var lyric = lrcText.split('\n');
                var lrc = [];
                var lyricLen = lyric.length;
                for (var  i = 0; i < lyricLen; i++) {
                    var lrcTimes = lyric[i].match(/\[(\d{2}):(\d{2})(\.(\d{2,3}))?]/g);
                    var lrcText = lyric[i].replace(/.*\[(\d{2}):(\d{2})(\.(\d{2,3}))?]/g, '').replace(/<(\d{2}):(\d{2})(\.(\d{2,3}))?>/g, '').replace(/^\s+|\s+$/g, '');
                    if (lrcTimes) {
                        var timeLen = lrcTimes.length;
                        for (var j = 0; j < timeLen; j++) {
                            var oneTime = /\[(\d{2}):(\d{2})(\.(\d{2,3}))?]/.exec(lrcTimes[j]);
                            var min2sec = oneTime[1] * 60;
                            var sec2sec = parseInt(oneTime[2]);
                            var msec2sec = oneTime[4] ? parseInt(oneTime[4]) / ((oneTime[4] + '').length === 2 ? 100 : 1000) : 0;
                            var lrcTime = (min2sec + sec2sec + msec2sec) * 1000;
                            lrc.push([lrcTime, lrcText]);
                        }
                    }
                }

                var isBanner = true;
                var maxBannerCount = 3;
                lrc = lrc.filter(function(item) {
                    if(!item[1]) {
                        return;
                    }
                    if(item[0] !== 0) {
                        isBanner = false;
                    }
                    if(item[0] === 0) {
                        if(!isBanner) {
                            return false;
                        } else {
                            if(maxBannerCount>0) {
                                maxBannerCount--;
                            } else {
                                return false;
                            }
                        }
                    }

                    return item[1];
                });
                lrc.reduce(function(arr, current) {
                    var lastGroup = arr.shift();
                    if(lastGroup && lastGroup.time !== current[0]) {
                        arr.push(lastGroup);
                        lastGroup = null;
                    }
                    if(!lastGroup) {
                        lastGroup = {
                            time: current[0],
                            lyric: []
                        };
                    }
                    lastGroup.lyric.push(lastGroup);
                    arr.push(lastGroup);
                    return arr;
                }, []).sort(function(a, b) {return a.time - b.time}).reduce(function(arr, current) {
                    if(current && current.lyric.length) {
                        return arr.concat(current.lyric);
                    }

                    return arr;
                }, []);

                return lrc;
            };

            Lrc.getLyricFromServer = function(url) {
                var deferred = makeDeferred();
                var xhr = new XMLHttpRequest;
                var ended = false;
                var aborted = false;
                xhr.open('GET', url, true);
                xhr.send();
                xhr.addEventListener('readystatechange', function() {
                    if(xhr.readyState === XMLHttpRequest.DONE) {
                        if(xhr.status === 200) {
                            var response = xhr.response;
                            deferred.resolve(response);
                        } else {
                            if(!aborted) {
                                deferred.reject(null);
                            }
                        }
                    }
                });

                var abort = function() {
                    if(!isResolved()) {
                        if(xhr && xhr.readyState !== 4) {
                            xhr.abort();
                            deferred.reject(null);
                        }
                    }
                };

                var isResolved = function() {
                    return ended || aborted;
                };

                return {
                    promise: deferred.promise,
                    abort: abort,
                    isResolved: isResolved
                };
            };

            Lrc.prototype.getLyric = function() {
                var that = this;
                if(this.isLoaded()) {
                    return Promise.resolve(this.isReady() ? this._parsedLyric : null);
                } else {
                    if(this._TrackItem && this._TrackItem.lrc) {
                        if(!this._requestingLrcJob || this._requestingLrcJob.isResolved()) {
                            var url = this._TrackItem.lrc;
                            this._requestingLrcJob = this.constructor.getLyricFromServer(url);
                        }
                        var promise = this._requestingLrcJob.promise;
                        var deferred = makeDeferred();
                        promise.then(function(data){
                            var lyric = that._onLyricRetrieved(data);
                            deferred.resolve(lyric);
                        })['catch'](function() {
                            deferred.reject(null);
                        });

                        return deferred.promise;
                    } else {
                        this._loaded = true;
                        return Promise.resolve(null);
                    }
                }
            };

            Lrc.prototype._onLyricRetrieved = function(lrc) {
                this._loaded = true;
                if(lrc) {
                    var parsedLrc = this.constructor.parse(lrc);
                    if(parsedLrc && parsedLrc.length > 0) {
                        this._parsedLyric = parsedLrc;
                        return this._parsedLyric;
                    }
                }

                return null;
            };

            Lrc.prototype.abortRequestingLrcJob = function() {
                if(this._requestingLrcJob && !this._requestingLrcJob.isResolved()) {
                    this._requestingLrcJob.abort();
                }
                this._requestingLrcJob = null;
            };

            Lrc.prototype.isLoaded = function() {
                return this._loaded;
            };

            Lrc.prototype.isReady = function () {
                return this._parsedLyric && this._parsedLyric.length > 0;
            };

            Lrc.prototype.isDestructed = function() {
                this._destructed = false;
            };

            Lrc.prototype.isSingleLineLyric = function() {
                if(this._singleLineLyric !== null) {
                    return this._singleLineLyric;
                } else if(this.isReady()) {
                    var lastTimeStamp = null;
                    var isMultipleLine = false;
                    for(var i=0; i<this._parsedLyric.length; i++) {
                        var thisLyric = this._parsedLyric[i];
                        if(lastTimeStamp !== thisLyric[0]) {
                            lastTimeStamp = thisLyric[0];
                        } else {
                            isMultipleLine = true;
                            break;
                        }
                    }
                    this._singleLineLyric = !isMultipleLine;
                }

                return this._singleLineLyric;
            };


            return Lrc;
        }();


        function Player(config) {

            if(config === void 0) {
                config = {};
            }
            if(!config.container) {
                throw new Error("Container must be exists.");
            }
            if(config.mode === void 0) {
                config.mode = TrackMode.REPEAT_LIST;
            }
            if(config.volume === void 0) {
                config.volume = 100;
            }
            if(config.customAudioType === void 0) {
                config.customAudioType = {};
            }
            if(config.playlist === void 0) {
                config.playlist = [];
            }
            if(config.handlers === void 0) {
                config.handlers = {};
            }

            var that = this;

            this._id = PLAYER_ID++;
            this._container = config.container;
            this._autoplay = config.autoplay || false;
            this._random = config.random || false;
            this._volume = config.volume;
            this._mode = config.mode;
            this._customAudioType = config.customAudioType;
            this._showAlbumName = config.showAlbumName || false;
            this._enableLyric = config.enableLyric || false;
            this._enableMediaSession = config.enableMediaSession || false;
            this._activeFade = config.activeFade || false;
            this._fadeDuration = config.fadeDuration || 200;
            this._initPlaylist = config.playlist;
            this._labels = config.labels || {};
            this._messages = config.messages || {};
            this._handlers = config.handlers;
            this._initialized = false;
            this._initTimerID = null;
            this._UI = null;
            this._Controller = null;
            this._Playback = null;
            this._Playlist = null;
            this._initializingDeferred = makeDeferred();
            this._initializingPromise = this._initializingDeferred.promise;

            this._destructed = false;
            this._initTimerID = window.setTimeout(function() {
                that._initTimerID = null;
                that.init();
            }, 0);
        }

        Player.TrackItem = TrackItem;

        Player.TrackMode = TrackMode;

        Player.Playlist = Playlist;

        Player.Tools = {
            extend: __extend,
            makeDeferred: makeDeferred
        };

        Player.prototype.getID = function() {
            return this._id;
        };

        Player.prototype.isInitialized = function() {
            return this._initialized;
        };

        Player.prototype.init = function() {
            if(!this.isInitialized()) {
                try {
                    var initConfig = {
                        container: this._container,
                        mode: this._mode,
                        volume: this._volume,
                        customAudioType: this._customAudioType,
                        showAlbumName: this._showAlbumName,
                        enableLyric: this._enableLyric,
                        activeFade: this._activeFade,
                        fadeDuration: this._fadeDuration,
                        playlist: this._initPlaylist,
                        labels: this._labels,
                        random: this._random,
                        messages: this._messages,
                        handlers: this._handlers
                    };

                    this._initialized = true;
                    this._Playlist = new Playlist(this, initConfig);
                    this._UI = new UI(this._container, this, initConfig);
                    this._Playback = new Playback(this, initConfig);
                    this._Lyric = this._enableLyric ? new Lyric(this, initConfig) : null;
                    this._Controller = new Controller(this);
                    this._initializingDeferred.resolve(this);
                } catch(e) {
                    this._initializingDeferred.reject(e);
                }
            }
        };

        Player.prototype.getInitializingPromise = function() {
            return this._initializingPromise;
        };

        Player.prototype._registerMediaSessionHandlers = function() {
            if(this._enableMediaSession && _MediaSession) {
                var that = this;
                _MediaSession.setActionHandler("play", function() {
                    that.play();
                });

                _MediaSession.setActionHandler("pause", function() {
                    that.pause();
                });

                _MediaSession.setActionHandler("seekbackward", function() {
                    that.seek(Math.max(0, that.getPosition() - SEEK_TIME));
                });

                _MediaSession.setActionHandler("seekforward", function() {
                    that.seek(Math.min(that.getDuration() || 0, that.getPosition() + SEEK_TIME));
                });

                _MediaSession.setActionHandler("previoustrack", function() {
                    if(that.getPosition() > 10000) {
                        that.seek(0);
                    } else {
                        that.skipBackward();
                    }
                });

                _MediaSession.setActionHandler("nexttrack", function() {
                    that.skipForward();
                });
            }
        };

        Player.prototype._updateMediaSessionMetadata = function(trackItem){
            if(this._enableMediaSession && _MediaSession && trackItem) {
                _MediaSession.metadata = new window.MediaMetadata({
                    title: trackItem.title ? trackItem.title : void 0,
                    artist: trackItem.artist ? trackItem.artist : void 0,
                    album: trackItem.album ? trackItem.album : void 0,
                    artwork: trackItem.albumArt ? [{src : trackItem.albumArt}] : void 0
                });
            }
        };

        Player.prototype._ensureNotDestructed = function() {
            if(this.isDestructed()) {
                throw new Error("Player was destructed.");
            }
        };

        Player.prototype.play = function() {
            this._ensureNotDestructed();
            var controller = this._Controller;
            var playback = this._Playback;
            if(!playback.getCurrentTrackItem()) {
                controller.resetPlaylistSequence();
            }
            if(playback.getCurrentTrackItem()) {
                return playback.play();
            } else {
                return Promise.reject({
                    type: 'not_found_track',
                    error: null
                });
            }
        };

        Player.prototype.pause = function() {
            this._ensureNotDestructed();
            var playback = this._Playback;
            var ui = this._UI;
            if(playback.isPlaying()) {
                ui.setUIPlaying();
                return playback.pause();
            }
        };

        Player.prototype.seek = function(position) {
            this._ensureNotDestructed();
            var playback = this._Playback;
            if(playback.getCurrentTrackItem()) {
                return playback.seek(position);
            } else {
                return Promise.reject({
                    type: 'not_found_track',
                    error: null
                });
            }
        };

        Player.prototype.skipBackward = function() {
            this._ensureNotDestructed();
            var playback = this._Playback;
            this._Controller.skipBackwardTrack(playback.isPlaying() || playback.isSignalledPlay());
        };

        Player.prototype.skipForward = function() {
            this._ensureNotDestructed();
            var playback = this._Playback;
            this._Controller.skipForwardTrack(playback.isPlaying() || playback.isSignalledPlay());
        };

        Player.prototype.getPosition = function() {
            if(this.isDestructed()) {
                return 0;
            }

            var playback = this._Playback;
            return playback.getPosition();
        };

        Player.prototype.getDuration = function() {
            var playback = this._Playback;
            if(this.isDestructed() || !playback.isReady()) {
                return 0;
            }

            return playback.getDuration();
        };

        Player.prototype.getMode = function() {
            return this._mode;
        };

        Player.prototype.isDestructed = function() {
            return this._destructed;
        };

        Player.prototype.isRandom = function() {
            return this._random;
        };

        Player.prototype.destruct = function() {
            if(!this.isDestructed()) {
                if(this._initTimerID) {
                    this._initTimerID = null;
                }

                this._Controller.destruct();
                this._Playback.destruct();
                this._UI.destruct();
                this._Playlist.destruct();
                if(this._Lyric) {
                    this._Lyric.destruct();
                }

                this._destructed = true;
            }

        };

        return Player;
    }();



    window.BluePlayer = BluePlayer;

})(window.jQuery);
