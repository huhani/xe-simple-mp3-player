(function($, $SimpleMP3Player) {
    if ($SimpleMP3Player === void 0 || window.BluePlayer === void 0) {
        return;
    }

    var autoplay = false;
    var useAutoStation = false;
    var mode = 1;
    var random = false;
    var useLyric = false;
    var limitMaxAutoStationTrack = 0;
    var showAlbumName = false;
    var enableMediaSession = true;
    var enableRealtimeStreaming = true;
    var TrackRandomForce = false;
    var bufferSize = 12;
    var AutoStationSearchFilter = true;
    var enableFade = false;
    var fadeDuration = 200;

    function buildBluePlayer($target, descriptions, usingLyric, document_srl, mid) {
        if($SimpleMP3Player && $SimpleMP3Player.config) {
            var config = $SimpleMP3Player.config;
            var confMode = config.BluePlayer__track_mode;
            useAutoStation = config.BluePlayer__use_autostation;
            mode = confMode === 'AutoStation' && useAutoStation ? 3 : confMode === 'RepeatTrack' ? 2 : confMode === 'RepeatList' ? 1 : 0;
            random = config.BluePlayer__track_random;
            useLyric = config.isMobile ? config.use_m_lyric : config.use_lyric;
            limitMaxAutoStationTrack = config.BluePlayer__autostation_max_size;
            autoplay = config.allow_autoplay;
            showAlbumName = config.BluePlayer_show_album_name;
            enableMediaSession = config.use_mediasession;
            enableRealtimeStreaming = config.use_mp3_realtime_streaming;
            TrackRandomForce = config.BluePlayer__track_random_force;
            bufferSize = config.mp3_realtime_buffer_size;
            AutoStationSearchFilter = config.BluePlayer__autostation_search_filter;
            enableFade = config.BluePlayer_enable_fade;
            fadeDuration = config.BluePlayer_fade_duration;
        }

        var CustomPlaylistManager = function(mid, document_srl, maxLoadedTrackCount, TrackRandomForce) {
            var DEFAULT_REQUESTING_LIST_COUNT = 1;

            var BasePlaylist = BluePlayer.Playlist;
            var PlaylistManager = BasePlaylist.PlaylistManager;
            var RandomPlaylistManager = BasePlaylist.RandomPlaylistManager;
            var getDefaultSongRequest = BasePlaylist.getDefaultSongRequest;
            var Tools = BluePlayer.Tools;
            var makeDeferred = Tools.makeDeferred;
            var TrackMode = BluePlayer.TrackMode;
            var __extend = Tools.extend;

            function getCustomSongRequest(promise, playlistManager) {
                var aborted = false;
                var resolved = false;
                promise.then(function(){
                    resolved = true;
                });
                return {
                    promise: promise,
                    abort: function() {
                        if(!resolved && !aborted) {
                            playlistManager.abortRequestingJob();
                            aborted = true;
                        }
                    },
                    isResolved: function() {
                        return resolved || aborted;
                    },
                    type: 'unknown'
                };
            }

            function getXHR(mid, document_srl, act, querystring) {
                var xhr = null;
                var ended = false;
                var aborted = false;
                var promise = new Promise(function(resolve, reject){
                    var searchQueryString = '';
                    if(AutoStationSearchFilter) {
                        var url = new URL(window.current_url || window.location.href);
                        var category_srl = url.searchParams.get("category");
                        var search_keyword = url.searchParams.get("search_keyword");
                        var search_target = url.searchParams.get("search_target");
                        if(category_srl) {
                            searchQueryString += category_srl ? ("&category_srl="+category_srl) : "";
                        }
                        if(search_keyword && search_target) {
                            searchQueryString += "&search_target="+search_target+"&search_keyword="+encodeURIComponent(search_keyword);
                        }
                    }
                    xhr = new XMLHttpRequest;
                    xhr.open('GET', window.default_url + 'index.php?mid='+mid+"&document_srl="+document_srl+searchQueryString+"&act="+act+(querystring ? ("&"+querystring) : ""), true);
                    xhr.send();
                    xhr.addEventListener('readystatechange', function() {
                        if(xhr.status >= 400 && xhr.status < 500) {
                            ended = true;
                            reject(xhr.status);
                        } else if(xhr.readyState === XMLHttpRequest.DONE) {
                            if(aborted) {
                                return reject({
                                    type: 'aborted',
                                    error: null
                                })
                            }
                            if(xhr.status === 200) {
                                ended = true;
                                resolve(JSON.parse(xhr.response));
                            } else {
                                reject(xhr.status);
                            }
                        }
                    }, false);
                });

                return {
                    promise: promise,
                    isResolved: function(){
                        return ended || aborted;
                    },
                    abort: function() {
                        if(!ended && !aborted && xhr) {
                            aborted = true;
                            xhr.abort();
                        }
                    }
                }
            }

            function getFileCount(mid, document_srl) {
                return getXHR(mid, document_srl, 'getFileCount');
            }

            function getFileDescription(mid, document_srl, offsets) {
                var offsetString = offsets.map(function(offset){
                    return 'offset[]='+offset;
                }).join('&');
                return getXHR(mid, document_srl, 'getFileDescription', offsetString);
            }

            function CustomPlaylistManager(Player) {
                var that = BasePlaylist.PlaylistManager.call(this, []) || this;
                that._player = Player;
                that._mid = mid;
                that._document_srl = document_srl;
                that._loadedListCount = false;
                that._requestingCountJob = null;
                that._requestingCountJobDeferred = null;
                that._previousListCount = null;
                that._nextListCount = null;
                that._randomListCount = null;
                that._previousListOffset = null;
                that._nextListOffset = null;
                that._randomListOffset = null;
                that._listOffsets = [];
                that._lastNextListOffset = null;
                that._lastPrevListOffset = null;
                that._lastRequestedNextListOffset = null;
                that._lastRequestedPrevListOffset = null;
                that._errors = [];
                that._requestingJob = null;
                that._descriptionQueue = [];
                that._random = false;
                that._RandomPlaylistManager = null;
                that._init();
            }

            __extend(CustomPlaylistManager, PlaylistManager);

            CustomPlaylistManager.prototype._init = function() {
                if(!this._loadedListCount) {
                    this._loadListCount();
                }
            };

            CustomPlaylistManager.prototype._loadListCount = function() {
                var that = this;
                if(this._requestingCountJob && !this._requestingCountJob.isResolved()) {
                    this._requestingCountJob.abort();
                }
                this._requestingCountJobDeferred = makeDeferred();
                this._requestingCountJob = this.getTrackCount();
                this._requestingCountJob.promise.then(function(data){
                    that._previousListCount = data.prev;
                    that._nextListCount = data.next;
                    that._randomListCount = data.random;
                    that._listOffsets = that.buildRandomOffset(that._randomListCount);
                    that._loadedListCount = true;
                    that._lastNextListOffset = that._previousListCount+1;
                    that._lastPrevListOffset = that._previousListCount;
                    that._lastRequestedNextListOffset = that._lastNextListOffset;
                    that._lastRequestedPrevListOffset = that._lastPrevListOffset;
                    that._totalLoadedCount = 0;
                    that._requestingCountJobDeferred.resolve(data);
                })['catch'](function(e) {
                    that._requestingCountJobDeferred.reject(e);
                });
                return this._requestingCountJobDeferred.promise;
            };

            CustomPlaylistManager.prototype.buildRandomOffset = function(size) {
                var arr = [];
                for(var i=1; i<=size; i++) {
                    arr.push(i);
                }

                return RandomPlaylistManager.prototype.buildPlaylist(arr);
            };

            CustomPlaylistManager.prototype.abortRequestingJob = function() {
                if(this._requestingJob && !this._requestingJob.isResolved()) {
                    this._requestingJob.abort();
                }
                this._requestingJob = null;
            };

            CustomPlaylistManager.prototype._handleError = function(err) {
                this._errors.push(err);
                console.error(err);
            };

            CustomPlaylistManager.prototype.getTrackCount = function() {
                var that = this;
                var deferred = makeDeferred();
                this._requestingCountJob = getFileCount(this._mid, this._document_srl);
                this._requestingCountJob.promise.then(function(data){
                    deferred.resolve(data);
                }).catch(function(e){
                    that._handleError(e);
                });

                return deferred;
            };

            CustomPlaylistManager.prototype.isCountLoading = function() {
                return this._requestingCountJob && !this._requestingCountJob.isResolved();
            };

            CustomPlaylistManager.prototype.isCountLoaded = function() {
                return this._loadedListCount;
            };

            CustomPlaylistManager.prototype.isRandom = function() {
                return this._random;
            };

            CustomPlaylistManager.prototype.getPlaylist = function() {
                var player = this._player;
                var playlist = player._Playlist;
                return playlist ? playlist.getPlaylist() : [];
            };

            CustomPlaylistManager.prototype.getNextSequenceOffsets = function() {
                var offsets = [];
                this._lastNextListOffset = this._lastRequestedNextListOffset;
                this._lastPrevListOffset = this._lastRequestedPrevListOffset;
                if(this.isRandom() || TrackRandomForce) {
                    while(this._listOffsets.length > 0) {
                        var offset = Math.floor(this._listOffsets.length * Math.random());
                        offsets.push(this._listOffsets[offset]);
                        if(offsets.length >= DEFAULT_REQUESTING_LIST_COUNT) {
                            break;
                        }
                    }
                } else {
                    var nextListEndedOffset = this._previousListCount + this._nextListCount;
                    for(var i= this._lastNextListOffset; i<= nextListEndedOffset; i++) {
                        if(offsets.length >= DEFAULT_REQUESTING_LIST_COUNT) {
                            break;
                        }
                        if(this._listOffsets.indexOf(i) > -1) {
                            offsets.push(i);
                            this._lastNextListOffset = i;
                        }
                    }
                    if(offsets.length < DEFAULT_REQUESTING_LIST_COUNT) {
                        for(var i=this._lastPrevListOffset; i>0; i--) {
                            if(this._listOffsets.indexOf(i) > -1) {
                                offsets.push(i);
                                this._lastPrevListOffset = i;
                            }
                            if(offsets.length >= DEFAULT_REQUESTING_LIST_COUNT) {
                                break;
                            }
                        }
                    }
                }

                return offsets;
            };

            CustomPlaylistManager.prototype.getNextTrackDescriptions = function() {
                this.abortRequestingJob();
                var that = this;
                var deferred = makeDeferred();
                this._requestingJob = deferred;
                var countLoadingPromise = null;
                if(this.isCountLoading()) {
                    countLoadingPromise = this._requestingCountJobDeferred.promise;
                } else if(this.isCountLoaded()) {
                    countLoadingPromise = window.Promise.resolve();
                } else {
                    countLoadingPromise = this._loadListCount();
                }
                countLoadingPromise.then(function(){
                    var offsets = that.getNextSequenceOffsets();
                    that._requestingJob = getFileDescription(that._mid, that._document_srl, offsets);
                    that._requestingJob.promise.then(function(data){
                        offsets.forEach(function(eachOffset){
                            var idx = that._listOffsets.indexOf(eachOffset);
                            if(idx > -1) {
                                that._listOffsets.splice(idx, 1);
                            }
                        });
                        if(data && data.descriptions && data.descriptions.length) {
                            that._descriptionQueue = that._descriptionQueue.concat(data.descriptions);
                            deferred.resolve(that._descriptionQueue);
                        } else {
                            deferred.reject({
                                type: 'not_found',
                                error: null
                            });
                        }
                        that._lastRequestedNextListOffset = that._lastNextListOffset;
                        that._lastRequestedPrevListOffset = that._lastPrevListOffset;
                    })['catch'](function(e){
                        if(e instanceof Error) {
                            that._handleError(e);
                        }
                        deferred.reject(e);
                    });
                });

                return deferred.promise;
            };

            CustomPlaylistManager.prototype.getTrackItemIndex = function(trackItem) {
                var player = this._player;
                var playlist = player._Playlist;
                return playlist ? playlist.getTrackItemIndex(trackItem) : -1;
            };

            CustomPlaylistManager.prototype._getNextTrack = function() {
                var that = this;
                var deferred = makeDeferred();
                var player = this._player;
                var playlist = player._Playlist;
                var onShift = function() {
                    var description = that._descriptionQueue.shift();
                    if(description) {
                        var descriptions = [{description:description}];
                        $SimpleMP3Player.descriptionDecorator(descriptions);
                        var convertPlaylist = buildPlaylist(descriptions, true);
                        var trackItemArr = playlist.addTrackItems(convertPlaylist);
                        deferred.resolve(trackItemArr.length ? trackItemArr[0] : null);
                        that._totalLoadedCount++;
                    } else {
                        deferred.resolve(null);
                    }
                };
                if(this._descriptionQueue.length) {
                    onShift();
                }
                this.getNextTrackDescriptions().then(function(){
                    onShift();
                })['catch'](function(){
                    deferred.resolve(null);
                });

                return deferred.promise;
            };

            CustomPlaylistManager.prototype.getPreviousTrackItem = function() {
                var player = this._player;
                var playback = player._Playback;
                var playlist = player._Playlist;
                var currentTrackItem = playback.getCurrentTrackItem();
                if(this.isRandom()) {
                    return this.getPreviousTrackFromHistory();
                } else {
                    return playlist._getPreviousTrackItem();
                }
            };

            CustomPlaylistManager.prototype.provideCurrentTrackItem = function(trackItem) {
                if(this._RandomPlaylistManager) {
                    this._RandomPlaylistManager.provideCurrentTrackItem(trackItem);
                }
                PlaylistManager.prototype.provideCurrentTrackItem.call(this, trackItem);
            };

            CustomPlaylistManager.prototype.getNextTrackItem = function(fromEndedEvent) {
                var player = this._player;
                var playback = player._Playback;
                var playlist = player._Playlist;
                var currentTrackItem = playback.getCurrentTrackItem();
                var random = this.isRandom();
                if(random && playlist && currentTrackItem) {
                    if(this.hasQueueEmpty()) {
                        if(!this._RandomPlaylistManager) {
                            this.setRandomPlaylistManager();
                        }
                        return this._RandomPlaylistManager.getNextTrackItem(fromEndedEvent);
                    } else {
                        this._RandomPlaylistManager = null;
                    }

                    return getCustomSongRequest(this._getNextTrack(), this);
                } else {
                    var currentTrackItemIndex = this.getTrackItemIndex(currentTrackItem);
                    var playlistCount = playlist.getTrackItemCount();
                    if(this.hasQueueEmpty() && currentTrackItemIndex+1>=playlistCount) {
                        currentTrackItemIndex = -1;
                    }
                    if(random && playlistCount) {
                        currentTrackItemIndex = Math.floor(Math.random() * playlistCount)-1;
                    }
                    if(currentTrackItemIndex >= -1 && currentTrackItemIndex+1<playlistCount) {
                        return getDefaultSongRequest(this.getPlaylist()[currentTrackItemIndex+1]);
                    } else {
                        return getCustomSongRequest(this._getNextTrack(), this);
                    }
                }
            };

            CustomPlaylistManager.prototype.hasQueueEmpty = function() {
                return this._listOffsets.length === 0 || (maxLoadedTrackCount && this._totalLoadedCount >= maxLoadedTrackCount);
            };

            CustomPlaylistManager.prototype.setRandom = function(random) {
                this._random = random;
                if(random && this.hasQueueEmpty()) {
                    this.setRandomPlaylistManager();
                } else {
                    this._RandomPlaylistManager = null;
                }
            };

            CustomPlaylistManager.prototype.setRandomPlaylistManager = function() {
                var player = this._player;
                var playlist = player ? player._Playlist : null;
                if(this.hasQueueEmpty() && playlist) {
                    this._RandomPlaylistManager = new RandomPlaylistManager(playlist.getPlaylist(), TrackMode.REPEAT_LIST);
                }
            };

            return CustomPlaylistManager;
        }(mid, document_srl, limitMaxAutoStationTrack, TrackRandomForce);
        var $section = $('<div></div>');
        $target.prepend($section);
        var PlayerManager = $SimpleMP3Player.PlayerManager;
        var PlayerObserver = $SimpleMP3Player.PlayerObserver;
        var BluePlayerObserver = PlayerObserver.BluePlayerObserver;
        var playlist = buildPlaylist(descriptions);
        var player = new window.BluePlayer({
            container: $section[0],
            playlist: playlist,
            volume: 100,
            showAlbumName: showAlbumName,
            enableLyric: useLyric,
            activeFade: enableFade,
            fadeDuration: fadeDuration,
            random: random,
            autoplay: false,
            mode: mode,
            enableMediaSession: enableMediaSession,
            labels: {
                play: '재생',
                pause: '일시정지',
                random: "랜덤재생",
                repeat: "반복설정",
                remove: "목록에서 삭제",
                more: "더 보기",
                close: "닫기",
                skipBackward: "이전 곡으로",
                skipForward: "다음 곡으로",
                rightClickPlay: "재생",
                rightClickPause: "일시정지",
                rightClickRemoveTrack: "목록에서 삭제"
            },
            messages: {
                loadingLyric: "가사를 불러오는 중입니다.",
                notFoundLyric: "가사를 찾을 수 없습니다."
            },
            handlers: {
                trackMenu: getTrackMenu,
                CustomPlaylist: mid && document_srl && useAutoStation ? CustomPlaylistManager : null
            },
            customAudioType: {
                hls: handlePlaybackLoading
            }
        });

        PlayerManager.registerPlayer(new BluePlayerObserver(player));

        window.tt=player;
    }

    var MSE = $SimpleMP3Player.MSE;
    var lastMSE = null;
    function handlePlaybackLoading(audioElement, trackItem) {
        if(trackItem) {
            var description = trackItem.description;
            if(lastMSE) {
                lastMSE.destruct();
            }
            if(enableRealtimeStreaming && MSE && MSE.isSupported() && description && description.offsetInfo) {
                lastMSE = new MSE(audioElement, trackItem.url, description.offsetInfo, description.file_srl, bufferSize);
                lastMSE.provideCacheManager($SimpleMP3Player.MemoryCacheManager);
            } else {
                audioElement.src = trackItem.url;
                audioElement.load()
            }
        }
    }

    function buildPlaylist(descriptions, allowRemove) {
        var playlist = [];
        var config = $SimpleMP3Player.config;
        var defaultCover = config.default_cover;
        var useThumbnail = config.use_thumbnail;
        if(defaultCover) {
            defaultCover = $SimpleMP3Player.convertURL2URI(defaultCover);
        }

        descriptions.forEach(function(each){
            var description = each.description;
            var offsetInfo = description.offsetInfo;
            var tags = description.tags;
            var stream = description.stream;
            if(!tags) {
                tags = {};
            }
            if(!offsetInfo) {
                offsetInfo = {};
            }
            if(!stream) {
                stream = {};
            }
            var file_srl = description.file_srl;
            var title = tags.title ? tags.title : description.filename;
            var artist = tags.artist ? tags.artist : null;
            var album = tags.album ? tags.album : null;
            var albumArt = tags.albumArt ? tags.albumArt : null;
            var duration = offsetInfo.duration ? offsetInfo.duration * 1000 : (stream.duration ? stream.duration * 1000 : null);
            var url = description.filePath;
            var type = null;
            var lrc = window.request_uri+'index.php?act=getSimpleMP3Lyric&file_srl='+file_srl+"&type=text";
            var lrcType = null;
            if(!albumArt) {
                if(useThumbnail && description.thumbnail) {
                    albumArt = description.thumbnail;
                } else if(defaultCover) {
                    albumArt = defaultCover;
                }
            }

            playlist.push({
                title:title,
                artist: artist,
                album: album,
                albumArt: albumArt,
                duration: duration,
                url: url,
                type: 'hls',
                lrc: lrc,
                allowRemove: allowRemove || false,
                description: description
            });
        });

        return playlist;
    }

    function onDescriptionLoad(data) {
        var $document_content = $('.xe_content[class*=document_]');
        var document_srl_regex = /document_(\d+)/.exec($('.xe_content[class*=document_]').attr('class') || '');
        var document_srl = document_srl_regex ? document_srl_regex[1] : null;
        if(document_srl && data && data.length) {
            var useLyric = false;
            if($SimpleMP3Player.config) {
                var config = $SimpleMP3Player.config;
                if((config.isMobile && config.use_m_lyric) || (!config.isMobile && config.use_lyric)) {
                    useLyric = true;
                }
            }

            buildBluePlayer($document_content, data, useLyric, document_srl, window.current_mid);
        }
    }

    function getTrackMenu(trackItem) {
        var menu = [];
        if(!trackItem.description) {
            return;
        }
        var description = trackItem.description;
        if(description.download_url) {
            menu.push({
                name: "다운로드",
                handler: getDownloadLinkHandler(trackItem)
            });
        }

        var config = $SimpleMP3Player.config;
        var enableDocumentThumbnailToUpdate = config.BluePlayer_enable_thumbnail_button;
        var isSupportedToSetThumbnail = config.is_supported_to_set_thumbnail;
        if(description.document_srl) {
            if(description.document_srl !== $SimpleMP3Player.document_srl) {
                menu.push({
                    name: "게시글 열기",
                    handler: getDocumentOpenHandler(description.document_srl)
                });
            } else if(isSupportedToSetThumbnail && enableDocumentThumbnailToUpdate && description.editable && description.tags && description.tags.albumArt) {
                menu.push({
                    name: "게시글 섬네일 변경",
                    handler: updateDocumentThumbnail(description.document_srl, description.file_srl)
                });
            }
        }


        return menu;
    }

    function updateDocumentThumbnail(document_srl, file_srl) {
        return function() {
            if(document_srl && file_srl) {
                var url = window.default_url + 'index.php?mid='+window.current_mid+'&act=updateSimpleMP3Thumbnail'+'&document_srl='+document_srl+'&file_srl='+file_srl
                var xhr = new XMLHttpRequest;
                xhr.open('GET', url, true);
                xhr.setRequestHeader("X-ADDONS-XSS-PROTECTOR", "OK");
                xhr.send();
                xhr.addEventListener('load', function(){
                    if(xhr.status === 200) {
                        var data = JSON.parse(xhr.response);
                        if(data.result) {
                            alert('게시글의 섬네일을 선택한 곡의 앨범 커버로 변경하였습니다.');
                        } else {
                            alert('게시글 섬네일을 변경하는 도중 오류가 발생했습니다.');
                        }
                    } else {
                        console.error(xhr);
                    }
                }, false);
            }
        };
    }

    function getDownloadLinkHandler(trackItem) {
        return function() {
            if(!trackItem.description) {
                return;
            }
            var description = trackItem.description;
            if(description.download_url) {
                window.open(description.download_url);
            }
        };
    }

    function getDocumentOpenHandler(document_srl) {
        return function() {
            if(document_srl) {
                window.open(window.default_url+'index.php?document_srl='+document_srl);
            }
        };
    }

    $(document).ready(function(){
        var subscriber = null;
        if($SimpleMP3Player.audioDescriptions && $SimpleMP3Player.audioDescriptions.length > 0) {
            onDescriptionLoad($SimpleMP3Player.audioDescriptions);
        } else {
            subscriber = $SimpleMP3Player.onAudioDescriptionLoad.subscribe(onDescriptionLoad);
        }
    });


})(window.jQuery, window.$SimpleMP3Player);
