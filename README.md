# Simple MP3 Player 애드온 

Simple MP3 Player 애드온은 XpressEngine에서 게시글의 첨부된 파일(mp3, m4a, ogg, flac)을 플레이어로 나타내주는 프로그램입니다.

특히, MP3파일의 경우 브라우저가 [Media Source Extension API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)를 지원할 경우 Progressive방식이 아닌 HLS나 MPEG-DASH와 같이 실시간으로 재생합니다.

이 애드온은 [XpressEngine](https://github.com/xpressengine/xe-core)기반으로 동작하며, [Rhymix](https://github.com/rhymix/rhymix)또한 호환 가능합니다.


# 체험

XE환경
[https://dev17.dnip.co.kr/index.php?mid=music](https://dev17.dnip.co.kr/index.php?mid=music)

# 테스트

애드온은 다음과 같은 환경에서 테스트하였습니다.

|XE              |PHP                 |description |
|----------------|--------------------|------------|
|1.8.27          |5.4	              |            |
|1.11.5          |7.0                 |            |
|1.11.5          |7.2                 |Win64       |

# 기능

심플 MP3 플레이어는 다음과 같은 기능을 제공합니다.

## 자동 태그 읽기

플레이어 로딩시 게시글의 첨부된 mp3, m4a, ogg, flac파일의 태그를 자동으로 가져옵니다.

## MP3 실시간 재생

브라우저가  [MSE](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API) 를 지원하는 경우 MP3파일의 프레임을 실시간으로 받아 재생합니다.

## MediaSession 지원
브라우저가 [MediaSession API](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession)를 지원하는 경우 안드로이드 알림창에서 재생을 관리 할 수 있도록 합니다.

## Link To HTML5 Player

파일을 첨부한 후 mp3파일을 본문에 삽입할 경우 자동으로 Audio 태그로 변환해 줍니다.

> **Note:** 이 기능은 CK에디터를 기준으로 제작하였으며, 다른 에디터를 사용할 경우 작동이 되지 않을 수 있습니다.


# 리소스

core-js https://github.com/zloirock/core-js#readme  
PHP-MP3 https://github.com/thegallagher/PHP-MP3  
multimedia-js https://github.com/tchakabam/multimedia-js  
APlayer https://github.com/MoePlayer/APlayer  
getID3 https://github.com/JamesHeinrich/getID3  