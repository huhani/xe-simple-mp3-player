<?php

if(!defined("__ZBXE__")) exit();

require_once('./addons/simple_mp3_player/lib/phpmp3.php');
require_once('./addons/simple_mp3_player/lib/getid3/getid3.php');
require_once('./addons/simple_mp3_player/simple_encrypt.module.php');

if(!class_exists('SimpleMP3Describer', false)) {
    class SimpleMP3Describer {
        private $use_encrypt = false;
        private $password = null;
        private $allow_browser_cache = false;

        public function __construct($allow_browser_cache = false, $use_encrypt = false, $password = null) {
            if($password) {
                $this->password = $password;
            }
            $this->allow_browser_cache = $allow_browser_cache;
            if($use_encrypt && SimpleEncrypt::isEncryptSupported()) {
                $this->use_encrypt = $use_encrypt;
                $this->password = $password ? $password : SimpleEncrypt::getPassword();
            }
        }

        public function getURLEncrypt($uploaded_filename) {
            return SimpleEncrypt::getEncrypt($uploaded_filename, $this->password);
        }

        public function getMIMEType($extension = null) {
            if($extension) {
                $extension = strtolower($extension);
                if($extension === 'mp3') {
                    return 'audio/mpeg';
                } else if($extension === 'm4a') {
                    return 'audio/mp4';
                } else if($extension === 'ogg') {
                    return 'audio/ogg';
                } else if($extension === 'flac') {
                    return 'audio/flac';
                }
            }

            return null;
        }

        private function createMP3URL($uploaded_filename, $args = array()) {
            if($this->allow_browser_cache) {
                return $uploaded_filename;
            }

            $argsArr = array();
            if($this->use_encrypt) {
                $argsArr[] = array('key'=> 'Signature', 'value' => $this->getURLEncrypt($uploaded_filename));
            } else {
                $argsArr[] = array('key'=> 'file', 'value' => $uploaded_filename);
            }

            $argsArr = array_merge($argsArr, $args);

            return $this->createURLWithParameters($argsArr, array('Signature', 'duration'));
        }

        private function createURLWithParameters($argsArr, $skipArgsArr = array()) {
            $url = './addons/simple_mp3_player/audioplayback.php?';
            $keys = array();
            $valueStr = '';
            $isFirst = true;
            foreach($argsArr as $arg) {
                $_arg= (object)$arg;
                $_arg->value = trim($_arg->value);
                if(!$_arg->value && $_arg->value != '0') {
                    $_arg->value = 'null';
                }
                if($isFirst) {
                    $url .= $_arg->key."=".urlencode($_arg->value);
                    $isFirst=false;
                } else {
                    $url .= "&".$_arg->key."=".urlencode($_arg->value);
                }
                if(in_array($_arg->key, $skipArgsArr)) {
                    continue;
                }
                $keys[] = $_arg->key;
                $valueStr .= $_arg->value;
            }

            $hash = md5($valueStr.$this->password);
            $url .= "&arguments=".implode(",", $keys);
            $url .= "&SN=".substr($hash, 0, 12);

            return $url;
        }

        public function getDescriptionsByDocumentSrl($document_srl) {
            if(!$this->isGranted($document_srl)) {
                return null;
            }
            $descriptions = array();
            $files = $this->getMultipleFilePathname($document_srl);
            $ip = $_SERVER['REMOTE_ADDR'];
            $timestamp = time();
            if($files) {
                foreach($files as $file) {
                    $description = $this->getDescriptionFile($file->file_srl, $file->uploaded_filename);
                    if(!$description) {
                        $description = $this->getMP3DescriptionFromOrigin($document_srl, $file->file_srl, $file->source_filename ,$file->uploaded_filename);
                    }
                    if($description) {
                        $fileParts = pathinfo($file->uploaded_filename);
                        $sourceFileParts = pathinfo($file->source_filename);
                        $extension = $fileParts && isset($fileParts['extension']) ? $fileParts['extension'] :
                            (isset($sourceFileParts['extension']) ? $sourceFileParts['extension'] : null);
                        if($extension) {
                            $extension = strtolower($extension);
                        }
                        if(isset($description->stream) && $description->stream && $description->stream->format) {
                            $format = $description->stream->format;
                            if($format === 'mp3' && $extension !== 'mp3') {
                                $extension = 'mp3';
                            }
                            if($format === 'flac' && $extension !== 'flac') {
                                $extension = 'flac';
                            }
                            if($format === 'mp4' && !($extension === 'mp4' ||$extension === 'm4a')) {
                                $extension = 'm4a';
                            }
                        }
                        $mime = $this->getMIMEType($extension);
                        if(!$mime) {
                            $mime = 'unknown';
                        }
                        if($description->offsetInfo) {
                            $offsetInfo = $description->offsetInfo;
                            $offsets = $offsetInfo->offsets;
                            $duration = $offsetInfo->duration;
                            $offsetSize = count($offsets);
                            $streamStartOffset = $offsets[0]->startOffset;
                            $streamEndOffset = $offsets[$offsetSize-1]->endOffset;
                            $description->filePath = $this->createMP3URL($file->uploaded_filename, array(
                                array('key'=>'streamStartOffset', 'value'=>$streamStartOffset),
                                array('key'=>'streamEndOffset', 'value'=>$streamEndOffset),
                                array('key'=>'document_srl', 'value'=>$document_srl),
                                array('key'=>'file_srl', 'value'=>$file->file_srl),
                                array('key'=>'mime', 'value'=>$mime),
                                array('key'=>'duration', 'value'=>$duration),
                                array('key'=>'timestamp', 'value'=>$timestamp),
                                array('key'=>'type', 'value'=>'progressive')
                            ));
                            if(!$this->allow_browser_cache) {
                                $currentOffset = 0;
                                foreach ($offsets as $eachOffset) {
                                    $eachOffset->url = $this->createMP3URL($file->uploaded_filename, array(
                                        array('key'=>'document_srl', 'value'=>$document_srl),
                                        array('key'=>'file_srl', 'value'=>$file->file_srl),
                                        array('key'=>'streamStartOffset', 'value'=>$streamStartOffset),
                                        array('key'=>'streamEndOffset', 'value'=>$streamEndOffset),
                                        array('key'=>'mime', 'value'=>$mime),
                                        array('key'=>'start', 'value'=>$eachOffset->startOffset),
                                        array('key'=>'end', 'value'=>$eachOffset->endOffset),
                                        array('key'=>'duration', 'value'=>$duration),
                                        array('key'=>'ip', 'value'=>$ip),
                                        array('key'=>'offset', 'value'=>$currentOffset),
                                        array('key'=>'timestamp', 'value'=>$timestamp),
                                        array('key'=>'type', 'value'=>'realtime')
                                    ));
                                    $currentOffset += $eachOffset->time;
                                }
                            }
                        } else {
                            $arguments = array(
                                array('key'=>'document_srl', 'value'=>$document_srl),
                                array('key'=>'file_srl', 'value'=>$file->file_srl),
                                array('key'=>'mime', 'value'=>$mime),
                                array('key'=>'ip', 'value'=>$ip),
                                array('key'=>'timestamp', 'value'=>$timestamp),
                                array('key'=>'type', 'value'=>'progressive')
                            );
                            if(isset($description->stream)) {
                                $stream = $description->stream;
                                if(isset($stream->duration)) {
                                    $arguments[] = array('key'=>'duration', 'value'=>$stream->duration);
                                }
                            }

                            $description->filePath = $this->createMP3URL($file->uploaded_filename, $arguments);
                        }
                    }
                    $obj = new stdClass;
                    $obj->file_srl = $file->file_srl;
                    $obj->description = $description;
                    $descriptions[] = $obj;
                }
            }

            return $descriptions;
        }

        static function getDescriptionFilePath($file_srl = null, $mp3FilePath = null) {
            $basepath = "./files/simple_mp3_player/";
            $regex = "/(\d+)\/(?:(\d+)\/)?(?:(\d+)\/)?\w+.\w+$/";
            preg_match_all($regex, $mp3FilePath, $result);
            if(count($result[1])) {
                return $basepath . $result[1][0] . "/" . (count($result[2]) && $result[2][0] ? ($result[2][0] . "/") : '') . (count($result[3]) && $result[3][0] ? ($result[3][0] . "/") : '') . ($file_srl ? ($file_srl . "/") : '');
            }

            return null;
        }

        function getDescriptionFile($file_srl, $pathname) {
            $basePath = self::getDescriptionFilePath($file_srl, $pathname);
            if($basePath) {
                $description = FileHandler::readFile($basePath."description.json");
                if($description) {
                    return json_decode($description);
                }
            }

            return null;
        }

        function getMP3DescriptionFromOrigin($document_srl, $file_srl, $source_filename = null, $filepath = null) {
            if(!$filepath) {
                $filepathData = $this->getFilePathname($file_srl, $document_srl);
                if($filepathData) {
                    $filepath = $filepathData->uploaded_filename;
                }
            }
            $descriptionFilePath = self::getDescriptionFilePath($file_srl, $filepath);
            if(!$filepath || !$descriptionFilePath) {
                return null;
            }
            $fileParts = pathinfo($filepath);
            $sourceFileParts = pathinfo($source_filename);
            $extension = $fileParts && isset($fileParts['extension']) ? $fileParts['extension'] :
                ($source_filename && $sourceFileParts && isset($sourceFileParts['extension']) ? $sourceFileParts['extension'] : null);
            if(!in_array($extension, array('mp3', 'm4a', 'flac', 'ogg'))) {
                return null;
            }

            $mp3Spec = $this->getMP3Sepc($filepath);
            $tags = $mp3Spec ? $mp3Spec->tags : null;
            $stream = $mp3Spec ? $mp3Spec->stream : null;
            $obj = new stdClass();
            $obj->filePath = $filepath;
            $obj->filename = $source_filename;
            $obj->offsetInfo = null;
            $obj->tags = $tags;
            $obj->stream = $stream;
            $obj->isValidFile = !!($stream && $stream->format);
            if(($stream && $stream->format === 'mp3') || (!$stream && $extension === 'mp3')) {
                $offsets = $this->getSplitPosition($filepath);
                $obj->isValidFile = !!(isset($offsets->duration) && $offsets->duration > 2);
                $obj->offsetInfo = $offsets;
            }

            return $this->createDescriptionFile($obj, $descriptionFilePath);
        }

        function createDescriptionFile($originDescription = null, $savePath) {
            if($originDescription && $savePath) {
                if(!FileHandler::makeDir($savePath)) {
                    return null;
                }
                FileHandler::removeFilesInDir($savePath);

                $tag = $originDescription->tags;
                $albumArt = $tag->albumArt;

                $albumArtBuffer = null;
                $albumArtExtension = null;
                if($albumArt && count($albumArt) >= 2) {
                    $albumArtBuffer = $albumArt['data'];
                    $albumArtExtension = $albumArt['image_mime'] === 'image/png' ? 'png' : ($albumArt['image_mime'] === 'image/gif' ? 'gif' : ($albumArt['image_mime'] === 'image/jpeg' ? 'jpg' : ($albumArt['image_mime'] === 'image/bmp' ? 'bmp' : null)));
                }

                unset($tag->albumArt);
                if($albumArtBuffer && $albumArtExtension) {
                    $albumArtFilePath = $savePath . "Cover." . $albumArtExtension;
                    FileHandler::writeFile($albumArtFilePath, $albumArtBuffer);
                    $tag->albumArt = $albumArtFilePath;
                }
                FileHandler::writeFile($savePath."description.json", json_encode($originDescription));

                return $originDescription;
            }

            return null;
        }

        function getSplitPosition($pathname) {
            try {
                $mp3 = new PHPMP3($pathname);
                $offsets = $mp3->getSplitPosition(array(2,3,5));
                if(count($offsets) < 3) {
                    return null;
                }

                $duration = 0;
                foreach($offsets as $key=>$value) {
                    $duration += $value->time;
                }

                $obj = new stdClass;
                $obj->duration = $duration;
                $obj->offsets = $offsets;

                return $obj;
            } catch(Exception $e) {
                return null;
            }
        }

        function isGranted($document_srl = 0) {
            if($document_srl) {
                $oDocumentModel = getModel('document');
                $oDocument = $oDocumentModel->getDocument($document_srl);

                return $oDocument->isExists() && $oDocument->isAccessible();
            }

            return false;
        }

        function getMultipleFilePathname($upload_target_srl = null) {
            if($upload_target_srl) {
                $oFileModel = getModel('file');
                $oFileList = $oFileModel->getFiles($upload_target_srl, array('file_srl', 'uploaded_filename', 'source_filename'));
                if($oFileList) {
                    return $oFileList;
                }
            }

            return array();
        }

        function getFilePathname($file_srl, $upload_target_srl = null) {
            if($file_srl) {
                $oFileModel = getModel('file');
                $oFile = $oFileModel->getFile($file_srl);
                if($oFile && (!$upload_target_srl || $upload_target_srl && $oFile->upload_target_srl == $upload_target_srl)) {
                    $obj = new stdClass;
                    $obj->uploaded_filename = $oFile->uploaded_filename;
                    $obj->source_filename = $oFile->source_filename;

                    return $obj;
                }
            }

            return null;
        }

        function getMP3Sepc($mp3Pathname) {
            try {
                $getID3 = new getID3;
                $ThisFileInfo = $getID3->analyze($mp3Pathname);
                if(!$ThisFileInfo || (isset($ThisFileInfo['error']) && count($ThisFileInfo['error']))) {
                    return null;
                }
                $tags = new stdClass();
                $tags->artist = null;
                $tags->title = null;
                $tags->album = null;
                $tags->albumArt = null;
                $stream = new stdClass();
                $stream->duration = isset($ThisFileInfo['playtime_seconds']) ? $ThisFileInfo['playtime_seconds'] : null;
                $stream->format = null;
                $stream->bitrate = null;
                $stream->bitrateMode = null;
                $stream->channels = null;
                $stream->channelMode = null;
                $stream->sampleRate = null;
                $stream->startOffset = isset($ThisFileInfo['avdataoffset']) ? $ThisFileInfo['avdataoffset'] : null;
                $stream->endOffset = isset($ThisFileInfo['avdataend']) ? $ThisFileInfo['avdataend'] : null;
                $simpleData = new stdClass();
                $simpleData->format = $ThisFileInfo['fileformat'];
                $simpleData->tags = $tags;
                $simpleData->stream = $stream;
                if(isset($ThisFileInfo['tags'])) {
                    $_tag = $ThisFileInfo['tags'];
                    $id3 = isset($_tag['id3v2']) ? $_tag['id3v2'] : (isset($_tag['id3v1']) ? $_tag['id3v1'] : null);
                    $vorbiscomment = isset($_tag['vorbiscomment']) ? $_tag['vorbiscomment'] : null;
                    $quicktime = isset($_tag['quicktime']) ? $_tag['quicktime'] : null;
                    $tagTraget = $id3 ? $id3 : $vorbiscomment;
                    if(!$tagTraget) {
                        $tagTraget = $quicktime ? $quicktime : null;
                    }
                    if($tagTraget) {
                        if(isset($tagTraget['title']) && count($tagTraget['title']) && $tagTraget['title'][0]) {
                            $tags->title = removeHackTag($tagTraget['title'][0]);
                        }
                        if(isset($tagTraget['artist']) && count($tagTraget['artist']) && $tagTraget['artist'][0]) {
                            $tags->artist = removeHackTag($tagTraget['artist'][0]);
                        }
                        if(isset($tagTraget['album']) && count($tagTraget['album']) && $tagTraget['album'][0]) {
                            $tags->album = removeHackTag($tagTraget['album'][0]);
                        }
                    }
                }
                if(isset($ThisFileInfo['comments']) && isset($ThisFileInfo['comments']['picture']) && count($ThisFileInfo['comments']['picture'])) {
                    $tags->albumArt = $ThisFileInfo['comments']['picture'][0];
                }
                if(isset($ThisFileInfo['audio'])) {
                    $audioData = $ThisFileInfo['audio'];
                    if(isset($audioData['dataformat']) && $audioData['dataformat']) {
                        $stream->format = $audioData['dataformat'];
                    }
                    if(isset($audioData['bitrate_mode']) && $audioData['bitrate_mode']) {
                        $stream->bitrateMode = $audioData['bitrate_mode'];
                    }
                    if(isset($audioData['sample_rate']) && $audioData['sample_rate']) {
                        $stream->sampleRate = $audioData['sample_rate'];
                    }
                    if(isset($audioData['bitrate']) && $audioData['bitrate']) {
                        $stream->bitrate = $audioData['bitrate'];
                    }
                    if(isset($audioData['channels']) && $audioData['channels']) {
                        $stream->channels = $audioData['channels'];
                    }
                    if(isset($audioData['channelmode']) && $audioData['channelmode']) {
                        $stream->channelMode = $audioData['channelmode'];
                    }
                }

                return $simpleData;

            } catch(Exception $e) {
                return null;
            }

        }

        static function onDeleteFile($pathname) {
            $descriptionPath = self::getDescriptionFilePath(null, $pathname);
            if($descriptionPath) {
                FileHandler::removeFilesInDir($descriptionPath);
                FileHandler::removeBlankDir($descriptionPath);
            }
        }

        public static function prepareToRemoveFilesFromTargetSrl($target_upload_srl) {
            $oFileModel = getModel('file');
            $oFileList = $oFileModel->getFiles($target_upload_srl);
            if(!isset($GLOBALS['__SIMPLE_MP3_PLAYER__'])) {
                $GLOBALS['__SIMPLE_MP3_PLAYER__'] = new stdClass;
                $GLOBALS['__SIMPLE_MP3_PLAYER__']->targetDeleteFiles = array();
            }
            foreach($oFileList as $oFile) {
                $GLOBALS['__SIMPLE_MP3_PLAYER__']->targetDeleteFiles[] = $oFile;
            }
        }

        public static function prepareToRemoveFilesFromByFileSrls($file_srls = array()) {
            $oFileModel = getModel('file');
            if(!isset($GLOBALS['__SIMPLE_MP3_PLAYER__'])) {
                $GLOBALS['__SIMPLE_MP3_PLAYER__'] = new stdClass;
                $GLOBALS['__SIMPLE_MP3_PLAYER__']->targetDeleteFiles = array();
            }
            foreach($file_srls as $file_srl) {
                $oFile = $oFileModel->getFile($file_srl);
                if($oFile) {
                    $GLOBALS['__SIMPLE_MP3_PLAYER__']->targetDeleteFiles[] = $oFile;
                }
            }
        }

        public static function HandleDeleteDescription() {
            if(isset($GLOBALS['__SIMPLE_MP3_PLAYER__']) && isset($GLOBALS['__SIMPLE_MP3_PLAYER__']->targetDeleteFiles)) {
                foreach($GLOBALS['__SIMPLE_MP3_PLAYER__']->targetDeleteFiles as $oDeletedFile) {
                    if($oDeletedFile && isset($oDeletedFile->uploaded_filename) && $oDeletedFile->uploaded_filename) {
                        self::onDeleteFile($oDeletedFile->uploaded_filename);
                    }
                }
            }
        }

    }
}

$act = Context::get('act');
if($called_position === 'before_module_init' && in_array($_SERVER['REQUEST_METHOD'], array('GET', 'POST'))){
    if(in_array($act, array('geSimpleMP3Description', 'geSimpleMP3Descriptions'))) {
        $config = new stdClass();
        $config->use_mediasession = !(isset($addon_info->use_mediasession) && $addon_info->use_mediasession === "N");
        $config->use_url_encrypt = !(isset($addon_info->use_url_encrypt) && $addon_info->use_url_encrypt === "N");
        $config->allow_autoplay = !(isset($addon_info->allow_autoplay) && $addon_info->allow_autoplay === "N");
        $config->link_to_media = (isset($addon_info->link_to_media) && $addon_info->link_to_media === "Y");
        $config->default_cover = isset($addon_info->default_cover) ? $addon_info->default_cover : null;
        $config->allow_browser_cache = (isset($addon_info->allow_browser_cache) && $addon_info->allow_browser_cache === "Y");
        $config->playlist_player_selector = isset($addon_info->playlist_player_selector) ? $addon_info->playlist_player_selector : null;
        if(!$config->default_cover) {
            $config->default_cover = './addons/simple_mp3_player/img/no_cover.png';
        }
        if(!$config->playlist_player_selector) {
            $config->playlist_player_selector = '.simple_mp3_player';
        }

        $password = null;
        if(SimpleEncrypt::getPassword()) {
            $password = SimpleEncrypt::getPassword();
        } else if(!SimpleEncrypt::buildNewPassword()) {
            $config->use_url_encrypt = false;
        } else {
            $password = SimpleEncrypt::getPassword();
        }

        if(!$password) {
            $config->use_url_encrypt = false;
            $config->allow_browser_cache = true;
        }

        $result = new stdClass();
        if($act === 'geSimpleMP3Descriptions') {
            ini_set('max_execution_time', 15);
            $document_srl = Context::get('document_srl');
            $describer = new SimpleMP3Describer($config->allow_browser_cache, $config->use_url_encrypt, $password);
            $descriptions = $describer->getDescriptionsByDocumentSrl($document_srl);
            $result->descriptions = $descriptions;
        }
        $result->message = "success";
        $result->config = $config;
        echo json_encode($result);

        exit();
    }

} else if(in_array($act, array('procFileDelete', 'procBoardDeleteDocument', 'procBoardDeleteComment'))) {
    if($called_position === 'before_module_proc') {
        $target_srl = Context::get('document_srl');
        if(!$target_srl) {
            $target_srl = Context::get('comment_srl');
        }
        if($target_srl) {
            SimpleMP3Describer::prepareToRemoveFilesFromTargetSrl($target_srl);
        } else {
            $file_srl = Context::get('file_srl');
            $file_srls = Context::get('file_srls');
            if($file_srls) {
                $file_srls = explode(',',$file_srls);
            } else if($file_srl) {
                $file_srls = array($file_srl);
            }
            if($file_srls) {
                SimpleMP3Describer::prepareToRemoveFilesFromByFileSrls($file_srls);
            }
        }
    } else if ($called_position === 'after_module_proc') {
        SimpleMP3Describer::HandleDeleteDescription();
    }

} else if($called_position == 'after_module_proc' && Context::getResponseMethod()!="XMLRPC" && Context::get('document_srl')) {
    Context::loadFile(array('./addons/simple_mp3_player/js/corejs.min.js', 'body', '', null), true);
    Context::loadFile(array('./addons/simple_mp3_player/js/transmuxer.js', 'body', '', null), true);
    Context::loadFile(array('./addons/simple_mp3_player/js/base.js', 'body', '', null), true);
    if(!isset($addon_info->playlist_player) || !$addon_info->playlist_player) {
        $addon_info->playlist_player = 'APlayer';
    }
    if($addon_info->playlist_player === 'APlayer') {
        Context::loadFile('./addons/simple_mp3_player/css/APlayer.min.css', true);
        Context::loadFile(array('./addons/simple_mp3_player/js/APlayer.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/aplayer_loader.js', 'body', '', null), true);
    } else if($addon_info->playlist_player === 'APlayer_fixed') {
        Context::loadFile('./addons/simple_mp3_player/css/APlayer.min.css', true);
        Context::loadFile(array('./addons/simple_mp3_player/js/APlayer.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/aplayer_fixed_loader.js', 'body', '', null), true);
    }
    if(isset($addon_info->link_to_media) && $addon_info->link_to_media === "Y") {
        Context::loadFile(array('./addons/simple_mp3_player/js/mp3link_to_player.js', 'body', '', null), true);
    }
}
