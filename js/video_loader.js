(function($, $SimpleMP3Player){
    if($SimpleMP3Player === void 0) {
        return;
    }

    var PlayerManager = $SimpleMP3Player.PlayerManager;
    var PlayerObserver = $SimpleMP3Player.PlayerObserver;
    var SimpleVideoPlayerObserver = PlayerObserver.SimpleVideoPlayerObserver;
    var convertURL2URI = $SimpleMP3Player.convertURL2URI;
    var _MediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession || null;



    var VideoResizeObserver = function() {
        function getVideoSize(video_x, video_y, wrapper_x) {
            var ratio = wrapper_x/video_x;
            return {
                width: Math.min(video_x, parseInt(video_x * ratio, 10)),
                height: Math.min(video_y, parseInt( video_y * ratio, 10))
            };
        }

        function VideoResizeObserver($wrapper) {
            this._$wrapper = $wrapper;
            this._player = [];
            this._destructed = false;
            this._onResizeHandler = this._onResize.bind(this);

            $(window).on('resize', this._onResizeHandler);
        }

        VideoResizeObserver.prototype._onResize = function(evt) {
            var innerWidth = this._$wrapper.innerWidth();
            if(innerWidth) {
                this._resizeAllPlayer(innerWidth);
            }
        };

        VideoResizeObserver.prototype._resizeAllPlayer = function(wrapperWidth) {
            if(!wrapperWidth) {
                wrapperWidth = this._$wrapper.innerWidth();
            }
            var that = this;
            this._player.forEach(function(player){
                that._resizePlayer(player, wrapperWidth);
            });
        };

        VideoResizeObserver.prototype._resizePlayer = function(player, targetWidth) {
            if(targetWidth === void 0) {
                targetWidth = this._$wrapper.innerWidth();
            }
            var playerResolution = player.getResolution();
            var playerNode = player.getPlayer();
            if(targetWidth && playerResolution && playerNode) {
                var resizedResolution = getVideoSize(playerResolution.width, playerResolution.height, targetWidth);
                $(playerNode).css({
                    width: resizedResolution.width,
                    height: resizedResolution.height
                });
            }
        };

        VideoResizeObserver.prototype.registerPlayer = function(player) {
            if(this._player.indexOf(player) === -1) {
                this._player.push(player);
                this._resizePlayer(player);
            }
        };

        VideoResizeObserver.prototype.unregisterPlayer = function(player) {
            var idx = this._player.indexOf(player);
            if(idx > -1) {
                this._player.splice(idx ,1);
            }
        };

        VideoResizeObserver.prototype.destruct = function() {
            if(!this._destructed) {
                $(window).off('resize', this._onResizeHandler);
                this._player = [];
                this._destructed = true;
            }

        };

        return VideoResizeObserver;
    }();

    var SimpleVideoPlayer = function() {

        var PLAYER_ID = 0;
        var SEEK_TIME = 10;

        function SimpleVideoPlayer(description, config) {
            this._id = PLAYER_ID++;
            this._description = description;
            this._video = document.createElement('video');
            this._loop = config.loop;
            this._mute = config.mute;
            this._gifMode = config.gifMode;
            this._onVideoPlayingHandler = this._onVideoPlaying.bind(this);
            this._onVideoEndedHandler = this._onVideoEnded.bind(this);
            this._onVideoClickHandler = this._onVideoClick.bind(this);
            this._autoplay = config.autoplay;
            this._preload = config.preload;
            this._enableMediaSession = config.enableMediaSession;
            this._src = config.src;
            this._title = config.title;
            this._artist = config.artist;
            this._album = config.album;
            this._albumArt = config.albumArt;
            this._width = config.width;
            this._height = config.height;
            this._hasAudio = config.hasAudio;
            this._ifClickToShowControls = config.ifClickToShowControls;

            this._init();
        }

        SimpleVideoPlayer.prototype._init = function() {
            this._video.addEventListener('playing', this._onVideoPlayingHandler, false);
            this._video.addEventListener('ended', this._onVideoEndedHandler, false);
            this._video.addEventListener('click', this._onVideoClickHandler, false);
            this._video.preload = this._gifMode ? 'auto' : this._preload;
            this._video.controls = true;
            this._video.setAttribute('controlslist',["nodownload"]);
            if(this._gifMode) {
                this._video.setAttribute('playsinline', '');
                this._video.setAttribute('webkit-playsinline', '');
                if(this._video.hasAttribute('controls')) {
                    this._video.removeAttribute('controls');
                }
            }
            if(this._mute || this._gifMode) {
                this._video.muted = true;
            }
            if(!this._gifMode) {
                this._video.setAttribute('controls', 'controls');
            }
            this._video.src = this._src;
            this._video.load();
            if(this._autoplay) {
                this.play();
            }
        };

        SimpleVideoPlayer.prototype._onVideoPlaying = function() {
            if(!this._gifMode && this._enableMediaSession) {
                this._registerMediaSessionHandlers();
                //this._updateMediaSessionMetadata();
            }
        };

        SimpleVideoPlayer.prototype._onVideoEnded = function() {
            if(this._loop && !isNaN(this._video.duration) && this._video.duration) {
                this.seek(0);
                this.play();
            }
        };

        SimpleVideoPlayer.prototype._onVideoClick = function() {
            if(this._ifClickToShowControls && this._video && !this._video.hasAttribute('controls')) {
                this._video.setAttribute('controls' ,'');
            }
        };

        SimpleVideoPlayer.prototype.seek = function() {
            if(!isNaN(this._video.duration) && this._video.duration) {
                this._video.currentTime = 0;
            }
        };

        SimpleVideoPlayer.prototype.play = function() {
            if(!isNaN(this._video.duration) && this._video.duration) {
                var promise = this._video.play();
                if(promise) {
                    promise['catch'](function(e) {
                        console.error(e);
                    });
                }
            } else {
                this._video.setAttribute('autoplay', 'autoplay');
            }
        };

        SimpleVideoPlayer.prototype._updateMediaSessionMetadata = function() {
            if(_MediaSession) {
                _MediaSession.metadata = new window.MediaMetadata({
                    title: this._title ? this._title : void 0,
                    artist: this.artist ? this._artist : void 0,
                    album: this.album ? this._album : void 0,
                    artwork: this._albumArt ? [{src : this._albumArt}] : void 0
                });
            }
        };

        SimpleVideoPlayer.prototype._registerMediaSessionHandlers = function() {
            if(_MediaSession) {
                var that = this;
                _MediaSession.setActionHandler("play", function() {
                    that._video.play();
                });

                _MediaSession.setActionHandler("pause", function() {
                    that._video.pause();
                });

                _MediaSession.setActionHandler("seekbackward", function() {
                    that._video.currentTime = Math.max(0, that._video.currentTime - SEEK_TIME);
                });

                _MediaSession.setActionHandler("seekforward", function() {
                    that._video.currentTime = Math.min(that._video.duration || 0, that._video.currentTime + SEEK_TIME);
                });

                _MediaSession.setActionHandler("previoustrack", null);

                _MediaSession.setActionHandler("nexttrack", null);
            }
        };

        SimpleVideoPlayer.prototype.getVideoNode = function() {
            return this._video;
        };

        SimpleVideoPlayer.prototype.getPlayer = function() {
            return this._video;
        };

        SimpleVideoPlayer.prototype.getResolution = function() {
            if(this._width && this._height) {
                return {
                    width: this._width,
                    height: this._height
                };
            }

            return null;
        };

        SimpleVideoPlayer.prototype.destruct = function() {
            if(!this._destruct) {
                this._video.removeEventListener('playing', this._onVideoPlayingHandler, false);
                this._video.removeEventListener('ended', this._onVideoEndedHandler, false);
                this._video.removeEventListener('click', this._onVideoClickHandler, false);
                this._destruct = true;
            }
        };

        return SimpleVideoPlayer;

    }();

    function loadVideoPlayers(data) {
        var $document_content = $('.xe_content[class*=document_]');
        if(!$document_content.length) {
            return;
        }

        var config = $SimpleMP3Player.config;
        var defaultCover = config.default_cover;
        var useThumbnail = config.use_thumbnail;
        var linkToMedia = config.link_to_media;
        var enableMediaSession = config.use_mediasession;
        var enableVideo = config.enable_video;
        var enableWebM = config.enable_webm;
        var videoAutoplay = config.video_autoplay;
        var videoAutoplayWithoutAudio = config.video_autoplay_without_audio;
        var videoLoop = config.video_loop;
        var videoLoopWithoutAudio = config.video_loop_without_audio;
        var enableVideoGIFMode = config.video_gif_without_audio;
        var videoGifModeIfClick = config.video_gif_mode_if_click;
        var videoPreload = config.video_preload;
        var videoResize = config.video_resize;
        var videoAutoAttach = config.video_auto_attach;
        if(!enableVideo) {
            return;
        }

        var resizeObserver = videoResize ? new VideoResizeObserver($document_content) : null;
        var linkToVideoDescriptions = [];
        var linkToVideoPlayers = [];
        var topAttachedDescriptions = [];
        var topAttachedPlayers = [];
        var buildPlayer = function(description) {
            var stream = description.stream;
            var video = stream.video ? stream.video : null;
            var isGIFMode = !stream.isAudio && enableVideoGIFMode;
            var autoplay = stream.isAudio ? videoAutoplay : videoAutoplayWithoutAudio;
            var loop = stream.isAudio ? videoLoop : videoLoopWithoutAudio;
            var preload = videoPreload;
            var src = description.filePath;
            var tags = description.tags ? description.tags : null;
            var title = tags && tags.title ? tags.title : description.filename;
            var artist = tags && tags.artist ? tags.artist : null;
            var album = tags && tags.album ? tags.album : null;
            var albumArt = tags && tags.albumArt ? tags.albumArt : null;
            var width = video && video.resolution_x ? video.resolution_x : null;
            var height = video && video.resolution_y ? video.resolution_y : null;
            var hasAudio =  stream ? stream.isAudio : false;
            var fileformat = stream ? stream.fileformat : null;
            if(!enableWebM && fileformat === 'webm') {
                return null;
            }
            if(!albumArt && useThumbnail && description.thumbnail) {
                albumArt = description.thumbnail;
            }
            if(!albumArt && defaultCover) {
                albumArt = defaultCover;
            }
            if(isGIFMode) {
                preload = 'auto';
                autoplay = true;
                loop = true;
            }
            if(stream && width && height) {
                var player = new SimpleVideoPlayer(description, {
                    loop: loop,
                    autoplay: hasAudio ? false : autoplay,
                    preload: preload,
                    gifMode: isGIFMode,
                    enableMediaSession: hasAudio && enableMediaSession,
                    title: title,
                    artist: artist,
                    album: album,
                    albumArt: albumArt,
                    width: width,
                    height: height,
                    hasAudio: hasAudio,
                    ifClickToShowControls: videoGifModeIfClick,
                    src: src
                });

                return player;
            }

            return null;
        };
        if(linkToMedia) {
            $document_content.find('a[data-file-srl]').each(function() {
                var that = this;
                var $this = $(this);
                var href = $this.attr('href');
                var file_srl = parseInt($this.attr('data-file-srl'), 10);
                var findDescription = data.find(function(description) {
                    return description.file_srl === file_srl;
                });
                if(findDescription) {
                    var description = findDescription.description;
                    var player = buildPlayer(description);
                    if(player) {
                        linkToVideoPlayers.push(player);
                        $this.replaceWith(player.getPlayer());
                        linkToVideoDescriptions.push(description);
                        if(resizeObserver) {
                            resizeObserver.registerPlayer(player);
                        }
                    }
                }
            });
        }
        if(videoAutoAttach) {
            data.filter(function(each){
                return each.description && linkToVideoDescriptions.indexOf(each.description) === -1;
            }).reverse().forEach(function(each){
                var description = each.description;
                var player = buildPlayer(description);
                if(player) {
                    topAttachedPlayers.unshift(player);
                    var $p = $('<p></p>');
                    $p.append(player.getPlayer());
                    $document_content.prepend($p);
                    topAttachedDescriptions.push(description);
                    if(resizeObserver) {
                        resizeObserver.registerPlayer(player);
                    }
                }
            });
        }

        linkToVideoPlayers.concat(topAttachedPlayers).forEach(function(eachPlayer) {
            console.log(eachPlayer);
            if(!eachPlayer._gifMode && eachPlayer._hasAudio) {
                PlayerManager.registerPlayer(new SimpleVideoPlayerObserver(eachPlayer));
            }
        });
    }

    $(document).ready(function(){
        var onDescriptionLoad = function(data){
            if(subscriber) {
                subscriber.remove();
                subscriber = null;
            }
            if(data && data.length) {
                loadVideoPlayers(data);
            }
        };
        var subscriber = null;
        if($SimpleMP3Player.videoDescriptions && $SimpleMP3Player.videoDescriptions.length > 0) {
            onDescriptionLoad($SimpleMP3Player.videoDescriptions);
        } else {
            subscriber = $SimpleMP3Player.onVideoDescriptionLoad.subscribe(onDescriptionLoad);
        }
    });

})(window.jQuery, window.$SimpleMP3Player);
