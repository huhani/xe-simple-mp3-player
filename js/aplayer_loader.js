(function($, $SimpleMP3Player){

    if($SimpleMP3Player === void 0 || window.APlayer === void 0) {
        return;
    }

    var SEEK_TIME = 20;

    var PlayerManager = $SimpleMP3Player.PlayerManager;
    var PlayerObserver = $SimpleMP3Player.PlayerObserver;
    var APlayerObserver = PlayerObserver.APlayerObserver;
    var convertURL2URI = $SimpleMP3Player.convertURL2URI;
    var MSE = $SimpleMP3Player.MSE;
    var _MediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession || null;
    var document_srl = null;

    function getAPlayerPlaylist(descriptions) {
        if(!descriptions) {
            return [];
        }
        var config = $SimpleMP3Player.config;
        var defaultCover = config.default_cover;
        var useThumbnail = config.use_thumbnail;
        if(defaultCover) {
            defaultCover = $SimpleMP3Player.convertURL2URI(defaultCover);
        }
        return descriptions.map(function(eachDescription){
            var description = eachDescription.description;
            if(!description) {
                return null;
            }
            var file_srl = eachDescription.file_srl;
            var filename = description.filename;
            var tags = description.tags || {};
            var title = tags.title  ? tags.title : filename ? filename : 'Untitled';
            var artist = tags.artist ? tags.artist : void 0;
            var albumArt = tags.albumArt ? convertURL2URI(tags.albumArt) : void 0;
            var mp3URL = convertURL2URI(description.filePath);
            if(!albumArt) {
                if(useThumbnail && description.thumbnail) {
                    albumArt = description.thumbnail;
                } else if(defaultCover) {
                    albumArt = defaultCover;
                }
            }

            return {
                name: title,
                artist: artist,
                cover: albumArt,
                url: mp3URL,
                description: description,
                file_srl: file_srl,
                type: 'customHls',
                lrc: window.request_uri+'index.php?act=getSimpleMP3Lyric&file_srl='+file_srl+"&type=text"
            };
        }).filter(function(each){
            return each !== null;
        });
    }

    function buildAPlayer($target, data, useLyric) {
        var useMediaSession = !!($SimpleMP3Player.config && $SimpleMP3Player.config.use_mediasession);
        var targetSelector = $SimpleMP3Player.config && $SimpleMP3Player.config.playlist_player_selector ? $SimpleMP3Player.config.playlist_player_selector : null;
        var enableRealtimeStreaming = true;
        var bufferSize = 12;
        if(targetSelector) {
            var $documentTarget = $(document).find(targetSelector);
            if($documentTarget.length) {
                $target = $documentTarget.first();
            }
        }
        if($SimpleMP3Player && $SimpleMP3Player.config) {
            var config = $SimpleMP3Player.config;
            enableRealtimeStreaming = config.use_mp3_realtime_streaming;
            bufferSize = config.mp3_realtime_buffer_size;
        }

        var $SimpleMP3PlaylistPlayer = $('<div id="SimpleMP3PlaylistPlayer__container"></div>');
        $target.prepend($SimpleMP3PlaylistPlayer);
        var playlist = getAPlayerPlaylist(data);
        var _MSE = null;
        var aPlayer = new window.APlayer({
            container: $SimpleMP3PlaylistPlayer[0],
            audio: playlist,
            autoplay: false,
            theme: '#FADFA3',
            preload: 'auto',
            volume: 1,
            lrcType: useLyric ? 3 : void 0,
            listFolded: false,
            listMaxHeight: '240px',
            customAudioType: {
                customHls: function(audioElement, audio, player) {
                    if(_MSE) {
                        _MSE.destruct();
                    }
                    if(enableRealtimeStreaming && MSE.isSupported() && audio && audio.description && audio.description.offsetInfo) {
                        _MSE = new MSE(audioElement, audio.url, audio.description.offsetInfo, audio.description.file_srl, bufferSize);
                        _MSE.provideCacheManager($SimpleMP3Player.MemoryCacheManager);
                    } else {
                        audioElement.src = audio.url;
                    }
                }
            }
        });

        PlayerManager.registerPlayer(new APlayerObserver(aPlayer));
        aPlayer.on('playing', handleOnPlaying.bind(aPlayer));

        function handleOnPlaying() {
            var currentList = this.list.audios.length && this.list.index >= 0 ? this.list.audios[this.list.index] : null;
            if(currentList) {
                var file_srl = currentList.file_srl;
                var description = currentList.description;
                var title = currentList.name ? currentList.name : 'Untitled';
                var artist = null;
                var album = null;
                var albumCover = currentList.cover ? currentList.cover : void 0;
                if(description && description.tags) {
                    var tags = description.tags;
                    artist = tags.artist ? tags.artist : void 0;
                    album = tags.album ? tags.album : void 0;
                }
                if(useMediaSession) {
                    updateMediaSessionMetadata(title, artist, album, albumCover);
                    registerMediaSessionHandlers(this, this.list.audios.length);
                }
            }
        }

        function updateMediaSessionMetadata(title, artist, album, artwork) {
            if(_MediaSession) {
                _MediaSession.metadata = new window.MediaMetadata({
                    title: title ? title : void 0,
                    artist: artist ? artist : void 0,
                    album: album ? album : void 0,
                    artwork: artwork ? [{src : artwork}] : void 0
                });
            }
        }

        function registerMediaSessionHandlers(aPlayer, size) {
            if(_MediaSession) {
                var audio = aPlayer.audio;
                _MediaSession.setActionHandler("play", function() {
                    aPlayer.play();
                });

                _MediaSession.setActionHandler("pause", function() {
                    aPlayer.pause();
                });

                _MediaSession.setActionHandler("seekbackward", function() {
                    audio.currentTime = Math.max(0, audio.currentTime - SEEK_TIME);
                });

                _MediaSession.setActionHandler("seekforward", function() {
                    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + SEEK_TIME);
                });

                _MediaSession.setActionHandler("previoustrack", size > 1 ? function() {
                    if(audio.currentTime && audio.currentTime > 10) {
                        audio.currentTime = 0;
                    } else {
                        aPlayer.skipBack();
                    }
                } : null);

                _MediaSession.setActionHandler("nexttrack", size > 1 ? function() {
                    aPlayer.skipForward();
                } : null);
            }
        }
    }



    function onDescriptionLoad(data) {
        var $document_content = $('.xe_content[class*=document_]');
        var document_srl_regex = /document_(\d+)/.exec($('.xe_content[class*=document_]').attr('class') || '');
        document_srl = document_srl_regex ? document_srl_regex[1] : null;
        if(document_srl && data && data.length) {
            var useLyric = false;
            if($SimpleMP3Player.config) {
                var config = $SimpleMP3Player.config;
                if((config.isMobile && config.use_m_lyric) || (!config.isMobile && config.use_lyric)) {
                    useLyric = true;
                }
            }

            buildAPlayer($document_content, data, useLyric);
        }
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
