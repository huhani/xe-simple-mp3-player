(function($, $SimpleMP3Player) {

    if ($SimpleMP3Player === void 0 || window.BluePlayer === void 0) {
        return;
    }

    function buildAPlayer($target, descriptions) {

        var $section = $('<div></div>');
        $target.prepend($section);
        var playlist = buildPlaylist(descriptions);


        var player = new window.BluePlayer({
            container: $section[0],
            playlist: playlist,
            volume: 100,
            enableLyric: false,
            enableRadio: false,
            random: false,
            autoplay: true,
            mode: 1,
            labels: {
                play: '재생',
                pause: '일시정지',
                random: "랜덤재생",
                repeat: "반복설정",
                remove: "목록에서 삭제",
                more: "더 보기",
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
                trackMenu: getTrackMenu
            },
            customAudioType: {
                hls: handlePlaybackLoading
            }
        });

        window.tt=player;
    }

    var customPlaylistManager = function() {

        var BasePlaylist = BluePlayer.Playlist;

        function getXHR(mid, document_srl, act, querystring) {
            var xhr = null;
            var ended = false;
            var aborted = false;
            var promise = new Promise(function(resolve, reject){
                xhr = new XMLHttpRequest;
                xhr.open('GET', window.default_url + 'index.php?mid='+mid+"&document_srl="+document_srl+"&act="+act+(querystring ? ("&"+querystring) : ""), true);
                xhr.send();
                xhr.addEventListener('readystatechange', function() {
                    if(xhr.status >= 400 && xhr.status < 500) {
                        ended = true;
                        reject(xhr.status);
                    } else if(xhr.readyState === XMLHttpRequest.DONE) {
                        if(xhr.status === 200) {
                            ended = true;
                            resolve(JSON.parse(xhr.response));
                        } else {
                            reject(xhr.status);
                        }
                    }
                }, false);

                xhr.addEventListener('abort', function() {
                    reject('aborted');
                }, false);
            });

            return {
                promise: promise,
                abort: function() {
                    if(!ended && !aborted && xhr) {
                        xhr.abort();
                    }
                }
            }
        }

        function getRandomFileCount(mid, document_srl) {
            return getXHR(mid, document_srl, 'getRandomDocumentCount');
        }

        function getRandomFileDescription(mid, document_srl, offset) {
            return getXHR(mid, document_srl, 'getRandomDocumentCount', 'offset='+offset);
        }


        function customPlaylistManager(Player) {
            var that = BasePlaylist.PlaylistManager.apply(this, arguments) || this;

        }

        BluePlayer.Tools.extend(customPlaylistManager, BasePlaylist.PlaylistManager);

        return customPlaylistManager;

    }();

    var MSE = $SimpleMP3Player.MSE;
    var lastMSE = null;
    function handlePlaybackLoading(audioElement, trackItem) {
        if(trackItem) {
            var description = trackItem.description;
            if(lastMSE) {
                lastMSE.destruct();
            }
            if(MSE && MSE.isSupported() && description && description.offsetInfo) {
                lastMSE = new MSE(audioElement, trackItem.url, description.offsetInfo);
            } else {
                audioElement.src = trackItem.url;
                audioElement.load()
            }
        }
    }

    function buildPlaylist(descriptions) {
        var playlist = [];
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
            var title = tags.title ? tags.title : description.filename;
            var artist = tags.artist ? tags.artist : null;
            var album = tags.album ? tags.album : null;
            var albumArt = tags.albumArt ? tags.albumArt : null;
            var duration = offsetInfo.duration ? offsetInfo.duration * 1000 : (stream.duration ? stream.duration * 1000 : null);
            var url = description.filePath;
            var type = null;
            var lrc = null;
            var lrcType = null;

            playlist.push({
                title:title,
                artist: artist,
                album: album,
                albumArt: albumArt,
                duration: duration,
                url: url,
                type: 'hls',
                allowRemove: true,
                description: description
            });
        });

        return playlist;
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

        return menu;
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

    function boot() {

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
