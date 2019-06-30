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

        return descriptions.map(function(eachDescription){
            var description = eachDescription.description;
            if(!description) {
                return null;
            }
            var file_srl = eachDescription.file_srl;
            var filename = description.filename;
            var tags = description.tags || {};
            var title = tags.title  ? tags.title : filename ? filename : 'Untitled';
            var artist = tags.artist ? tags.artist : '-';
            var albumArt = tags.albumArt ? convertURL2URI(tags.albumArt) : void 0;
            var mp3URL = convertURL2URI(description.filePath);
            return {
                name: title,
                artist: artist,
                cover: albumArt,
                url: mp3URL,
                description: description,
                file_srl: file_srl,
                type: 'customHls'
            };
        }).filter(function(each){
            return each !== null;
        });
    }

    function buildAPlayer($target, data) {
        var ua = typeof window.navigator !== "undefined" ? window.navigator.userAgent : "";
        if (ua.indexOf("Trident/") >= 0 || ua.indexOf("MSIE ") >= 0) {
            return;
        }
        var useMediaSession = !!($SimpleMP3Player.config && $SimpleMP3Player.config.use_mediasession);
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
            fixed: true,
            volume: 1,
            listFolded: false,
            listMaxHeight: '240px',
            customAudioType: {
                customHls: function(audioElement, audio, player) {
                    if(_MSE) {
                        _MSE.destruct();
                    }
                    if(MSE.isSupported() && audio && audio.description && audio.description.offsetInfo) {
                        _MSE = new MSE(audioElement, audio.url, audio.description.offsetInfo);
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

                _MediaSession.setActionHandler("previoustrack", size > 0 ? function() {
                    aPlayer.skipBack();
                } : null);

                _MediaSession.setActionHandler("nexttrack", size > 0 ? function() {
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
            buildAPlayer($('body'), data);
        }
    }


    $(document).ready(function(){
        var subscriber = null;
        if($SimpleMP3Player.descriptions && $SimpleMP3Player.descriptions.length > 0) {
            onDescriptionLoad($SimpleMP3Player.descriptions);
        } else {
            subscriber = $SimpleMP3Player.onMP3DescriptionLoad.subscribe(onDescriptionLoad);
        }
    });


})(window.jQuery, window.$SimpleMP3Player);
