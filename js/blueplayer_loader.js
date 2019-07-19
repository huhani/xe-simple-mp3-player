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
            mode: 1
        });

        window.tt=player;
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
            var duration = offsetInfo.duration ? offsetInfo.duration : (stream.duration ? stream.duration : null);
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
                type: null,
                allowRemove: false,
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
