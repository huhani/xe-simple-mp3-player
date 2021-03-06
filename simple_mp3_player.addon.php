<?php

if(!defined("__ZBXE__")) exit();

require_once('./addons/simple_mp3_player/lib/HttpClient.class.php');
require_once('./addons/simple_mp3_player/lib/phpmp3.php');
require_once('./addons/simple_mp3_player/lib/getid3/getid3.php');
require_once('./addons/simple_mp3_player/simple_encrypt.module.php');

if(!class_exists('SimpleMP3Tools', false)) {
    class SimpleMP3Tools {
        public static function getRandomFile($mid, $document_srl, $offset = 1, $category_srl = null, $search_target = null, $search_keyword = null) {
            $module_data = self::getBoardModuleInfo($mid);
            if(!$module_data) {
                return null;
            }
            $module_info = $module_data->module_info;
            $module_grant = $module_data->grant;
            if(!$module_grant || !$module_grant->access || !$module_grant->view) {
                return null;
            }
            $oDocumentModel = getModel('document');
            $oDocument = $oDocumentModel->getDocument($document_srl);
            if(!$oDocument || !$oDocument->isExists() || !$oDocument->isAccessible() || $module_info->module_srl != $oDocument->get('module_srl')) {
                return null;
            }

            $baseQueryData = self::getListQueryString($search_target, $search_keyword);
            $queries = $baseQueryData->queries;
            $args = $baseQueryData->arguments;
            $args->module_srl = $module_info->module_srl;
            $args->status = 'PUBLIC';
            $args->category_srl = $category_srl ? $category_srl : null;
            $args->file_extension = implode(',', array('.mp3', '.m4a'));
            $args->isvalid = "Y";
            $args->page = $offset;
            $args->list_order = $oDocument->get('list_order');
            $args->sort_index = 'documents.list_order';
            $output = executeQuery($queries->documentByOffset, $args);
            if(!$output->toBool()) {
                return null;
            }

            return $output;
        }

        public static function getFileCount($mid, $document_srl, $category_srl = null, $search_target = null, $search_keyword = null) {
            $module_data = self::getBoardModuleInfo($mid);
            if(!$module_data) {
                return null;
            }
            $module_info = $module_data->module_info;
            $module_grant = $module_data->grant;
            if(!$module_grant || !$module_grant->access || !$module_grant->view) {
                return null;
            }
            $oDocumentModel = getModel('document');
            $oDocument = $oDocumentModel->getDocument($document_srl);
            if(!$oDocument || !$oDocument->isExists() || !$oDocument->isAccessible() || $module_info->module_srl != $oDocument->get('module_srl')) {
                return null;
            }

            $order_target = $module_info->order_target;

            $countData = new stdClass;
            $countData->prev = null;
            $countData->next = null;
            $countData->random = null;

            $baseQueryData = self::getListQueryString($search_target, $search_keyword);
            $queries = $baseQueryData->queries;
            $args = $baseQueryData->arguments;
            $args->module_srl = $module_info->module_srl;
            $args->status = 'PUBLIC';
            $args->category_srl = $category_srl ? $category_srl : null;
            $args->file_extension = implode(',', array('.mp3', '.m4a'));
            $args->isvalid = "Y";
            $args->list_order = $oDocument->get('list_order');
            $args->sort_index = 'documents.list_order';
            if($order_target === 'list_order') {
                $args->list_order = $oDocument->get('list_order');
                $args->sort_index = 'documents.list_order';
            } else {
                $args->update_order = $oDocument->get('update_order');
                $args->sort_index = 'documents.update_order';
            }
            $output = executeQuery($queries->documentCount, $args);
            $args->order_type = 'desc';
            $output1 = executeQuery($queries->nextDocumentCount, $args);
            $args->order_type = 'asc';
            $output2 = executeQuery($queries->prevDocumentCount, $args);
            if(($search_target === 'tag' || $search_target === 'comment') && $search_keyword) {
                if($output->toBool()) {
                    $countData->random = $output->page_navigation->total_count;
                }
                if($output1->toBool()) {
                    $countData->next = $output1->page_navigation->total_count;
                }
                if($output2->toBool()) {
                    $countData->prev = $output2->page_navigation->total_count;
                }
            } else {
                if($output->toBool()) {
                    $countData->random = $output->data->count;
                }
                if($output1->toBool()) {
                    $countData->next = $output1->data->count;
                }
                if($output2->toBool()) {
                    $countData->prev = $output2->data->count;
                }
            }


            return $countData;
        }

        public static function getBoardModuleInfo($mid = null) {
            if($mid) {
                $oModuleModel = getModel('module');
                $module_info = $oModuleModel->getModuleInfoByMid($mid);
                if(!$module_info) {
                    return null;
                }
                $member_info = Context::get('logged_info');
                if(!$member_info) {
                    $member_info = new stdClass;
                    $member_info->is_admin = "N";
                    $member_info->member_srl = null;
                }
                $oModuleGrant = $oModuleModel->getGrant($module_info, $member_info);
                $obj = new stdClass;
                $obj->module_info = $module_info;
                $obj->grant = $oModuleGrant;

                return $obj;
            }

            return null;
        }

        public static function getListQueryString($search_target = null, $search_keyword = null) {
            $queryStringPrefix = 'addons.simple_mp3_player.';

            $queryStrs = new stdClass;
            $queryArgs = new stdClass;
            $queryStrs->prevDocumentCount = $queryStringPrefix.'getPrevDocumentCount';
            $queryStrs->nextDocumentCount = $queryStringPrefix.'getNextDocumentCount';
            $queryStrs->documentCount = $queryStringPrefix.'getRandomDocumentCount';
            $queryStrs->documentByOffset = $queryStringPrefix.'getRandomDocumentByOffset';
            if($search_target && $search_keyword) {
                switch($search_target) {
                    case 'title' :
                    case 'content' :
                        if($search_keyword) $search_keyword = str_replace(' ','%',$search_keyword);
                    $queryArgs->{"s_".$search_target} = $search_keyword;
                        break;
                    case 'title_content' :
                        if($search_keyword) $search_keyword = str_replace(' ','%',$search_keyword);
                        $queryArgs->s_title = $search_keyword;
                        $queryArgs->s_content = $search_keyword;
                        break;
                    case 'nick_name' :
                        if($search_keyword) $search_keyword = str_replace(' ','%',$search_keyword);
                        $queryArgs->{"s_".$search_target} = $search_keyword;
                        break;
                    case 'comment' :
                        $queryArgs->s_comment = $search_keyword;
                        $queryStrs->prevDocumentCount = $queryStringPrefix.'getPrevDocumentCountFromComment';
                        $queryStrs->nextDocumentCount = $queryStringPrefix.'getNextDocumentCountFromComment';
                        $queryStrs->documentCount = $queryStringPrefix.'getRandomDocumentCountFromComment';
                        $queryStrs->documentByOffset = $queryStringPrefix.'getRandomDocumentByOffsetFromComment';
                        break;
                    case 'tag' :
                        $queryArgs->s_tags = str_replace(' ','%',$search_keyword);
                        $queryStrs->prevDocumentCount = $queryStringPrefix.'getPrevDocumentCountFromTag';
                        $queryStrs->nextDocumentCount = $queryStringPrefix.'getNextDocumentCountFromTag';
                        $queryStrs->documentCount = $queryStringPrefix.'getRandomDocumentCountFromTag';
                        $queryStrs->documentByOffset = $queryStringPrefix.'getRandomDocumentByOffsetFromTag';
                        break;
                    default :
                        if(strpos($search_target,'extra_vars')!==false) {
                            $queryArgs->var_idx = substr($search_target, strlen('extra_vars'));
                            $queryArgs->var_value = str_replace(' ','%',$search_keyword);
                            $queryStrs->prevDocumentCount = $queryStringPrefix.'getPrevDocumentCountFromExtraVars';
                            $queryStrs->nextDocumentCount = $queryStringPrefix.'getNextDocumentCountFromExtraVars';
                            $queryStrs->documentCount = $queryStringPrefix.'getRandomDocumentCountFromExtraVars';
                            $queryStrs->documentByOffset = $queryStringPrefix.'getRandomDocumentByOffsetFromExtraVars';
                        }
                        break;
                }
            }

            $returnObj = new stdClass;
            $returnObj->queries = $queryStrs;
            $returnObj->arguments = $queryArgs;

            return $returnObj;
        }

        public static function setDocumentThumbnail($document_srl = null, $file_srl = null, $_addon_config) {
            if(!self::isSupportedToSetThumbnail()) {
                return null;
            }

            $isGranted = SimpleMP3Describer::isAccessibleDocument($document_srl);
            if(!$document_srl || !$isGranted) {
                return null;
            }
            $oDocumentModel = getModel('document');
            $oDocument = $oDocumentModel->getDocument($document_srl);
            if(!$oDocument->isExists()) {
                return null;
            }
            $module_srl = $oDocument->get('module_srl');
            $target_file_srl = $file_srl;
            $useFirstImage = false;
            $firstDescriptionImage = null;


            $simpleMP3Describer = new SimpleMP3Describer($_addon_config);
            $descriptions = $simpleMP3Describer->getDescriptionsByDocumentSrl($document_srl, $_addon_config->thumbnail_type, $_addon_config->thumbnail_width, $_addon_config->thumbnail_height, $_addon_config->mp3_realtime_segment_duration, true);

             if(!$module_srl || !$descriptions || count($descriptions) < 1) {
                 return null;
             }
            if($file_srl) {
                if(!$oDocument->isGranted()) {
                    return false;
                }
            } else if(!self::isDocumentThumbnailExist($oDocument)) {
                $useFirstImage = true;
            }

            $target_file_srl = (int)$target_file_srl;
            $targetDescription = null;
            foreach($descriptions as $eachDescription) {
                $description = isset($eachDescription->description) && $eachDescription->description ? $eachDescription->description : null;
                $file_srl = $description && isset($description->file_srl) && $description->file_srl ? $description->file_srl : null;
                $tags = $description && isset($description->tags) && $description->tags ? $description->tags : null;
                $albumArt = $tags && isset($tags->albumArt) && $tags->albumArt ? $tags->albumArt : null;
                $poster = $description->poster;
                if($albumArt || ($poster && $_addon_config->video_thumbnail)) {
                    if($useFirstImage && !$firstDescriptionImage) {
                        $firstDescriptionImage = $description;
                    }
                    if($target_file_srl && $file_srl) {
                        if($target_file_srl === $description->file_srl) {
                            $targetDescription = $description;
                            break;
                        }
                    }
                }
            }

            if($useFirstImage && $firstDescriptionImage) {
                $targetDescription = $firstDescriptionImage;
            }

            if($targetDescription) {
                $type = null;
                $image = null;
                if($targetDescription->tags && $targetDescription->tags->albumArt) {
                    $image = $targetDescription->tags->albumArt;
                    $type = 'albumart';
                } else if($targetDescription->poster) {
                    $image = $targetDescription->poster;
                    $type = 'poster';
                }
                if($image) {
                    $documentThumbnailInsertType = $_addon_config->document_thumbnail_insert_type;
                    self::removeDocumentThumbnailFromAddons($oDocument);
                    if($documentThumbnailInsertType === 'insert_file' && self::isSupportedToSetThumbnail()) {
                        $file_srl = $targetDescription->file_srl;
                        $targetAlbumArtInfo = pathinfo($image);
                        $extension = $targetAlbumArtInfo && isset($targetAlbumArtInfo['extension']) ? $targetAlbumArtInfo['extension'] : null;
                        $basename = $targetAlbumArtInfo && isset($targetAlbumArtInfo['basename']) ? $targetAlbumArtInfo['basename'] : null;
                        $dirname = $targetAlbumArtInfo && isset($targetAlbumArtInfo['dirname']) ? $targetAlbumArtInfo['dirname'] : null;
                        $source_filename_without_extension = substr($targetDescription->filename, 0, strrpos($targetDescription->filename, "."));
                        if($file_srl && $extension && $basename && $dirname) {
                            $mime = mime_content_type($image);
                            $filesize = filesize($image);

                            if($filesize) {
                                $copypath = $dirname.'/'.'image.tmp';
                                $isCopied = copy($image, $copypath);
                                if(!$isCopied) {
                                    return null;
                                }
                                $fileInformationArray = array(
                                    'name' => ($type == 'albumart' ? "cover_" : "poster_").$source_filename_without_extension.'.'.$extension,
                                    'type' => $mime,
                                    'tmp_name' => $copypath,
                                    'error' => 0,
                                    'size' => $filesize
                                );

                                self::removeDocumentThumbnailFromContent($oDocument);
                                $oFileController = getController('file');
                                $oUploadedFile = $oFileController->insertFile($fileInformationArray, $module_srl, $document_srl, 0, true);
                                if($oUploadedFile->toBool()) {
                                    $args = new stdClass;
                                    $args->upload_target_srl = $document_srl;
                                    $args->isvalid = 'Y';
                                    executeQuery('addons.simple_mp3_player.updateFileValid', $args);
                                    $oDocumentController = getController('document');
                                    $oDocumentController->updateUploaedCount(array($document_srl));
                                    self::updateDocumentThumbnail($document_srl, $oUploadedFile->get('file_srl'));
                                }
                                if(file_exists($copypath)) {
                                    FileHandler::removeFile($copypath);
                                }

                                return true;
                            }
                        }
                    } else if($documentThumbnailInsertType === 'insert_image' || $documentThumbnailInsertType === 'insert_image_hide') {
                        $documentContent = $oDocument->get('content');
                        $oContext = Context::getInstance();
                        $requestVars = Context::getRequestVars();
                        if(isset($requestVars->content) && $requestVars->content) {
                            $documentContent = $requestVars->content;
                        }
                        if($documentContent) {
                            $documentContent = preg_replace("/<!--DocumentThumbnailStart-->(?:.*|\n)+?<!--DocumentThumbnailEnd-->/", "", $documentContent);
                            $imgTag = sprintf('<img src="%s">', $image);
                            $imgTag = preg_replace('/\/.\//', "/", $imgTag);
                            if($documentThumbnailInsertType === 'insert_image_hide') {
                                //$imgTag = '<!-- '.$imgTag.' -->';
                                $imgTag = '<p style="display:none;">' . $imgTag . '</p>';
                            }
                            $imgTag = sprintf('<!--DocumentThumbnailStart-->%s<!--DocumentThumbnailEnd-->', $imgTag);
                            $targetDocumentContent = $imgTag.$documentContent;

                            $args = new stdClass;
                            $args->document_srl = $document_srl;
                            $args->content = $targetDocumentContent;
                            $output = executeQuery('addons.simple_mp3_player.updateDocumentContent', $args);
                            if($output->toBool()) {
                                $oContext->set('content', $documentContent, TRUE);
                                $thumbnail_path = sprintf('files/thumbnails/%s', getNumberingPath($document_srl, 3));
                                Filehandler::removeFilesInDir($thumbnail_path);

                                return true;
                            }
                        }
                    }
                }
            }

            return false;
        }

        public static function isDocumentThumbnailExist($oDocument) {
            $source_file = null;
            if($oDocument->hasUploadedFiles()) {
                $file_list = $oDocument->getUploadedFiles();
                $first_image = null;
                foreach($file_list as $file) {
                    if($file->direct_download !== 'Y') {
                        continue;
                    }
                    if($file->cover_image === 'Y' && file_exists($file->uploaded_filename)) {
                        $source_file = $file->uploaded_filename;
                        break;
                    }
                    if($first_image) {
                        continue;
                    }
                    if(preg_match("/\.(jpe?g|png|gif|bmp)$/i", $file->source_filename)) {
                        if(file_exists($file->uploaded_filename)) {
                            $first_image = $file->uploaded_filename;
                        }
                    }
                }
                if(!$source_file && $first_image) {
                    $source_file = $first_image;
                }
            }

            return !!$source_file;
        }

        public static function removeDocumentThumbnailFromAddons($oDocument) {
            if($oDocument->hasUploadedFiles()) {
                $oFileController = getController('file');
                $oFileList = $oDocument->getUploadedFiles();
                foreach($oFileList as $oFile){
                    $each_source_filename = $oFile->source_filename;
                    preg_match('/^Cover##([0-9]+)\.(?:jpe?g|png|gif|bmp)+$/', $each_source_filename, $matches);
                    if(is_array($matches) && count($matches) > 0) {
                        $file_srl = (int)$matches[1];
                        if($file_srl) {
                            $oFileController->deleteFile($oFile->file_srl);
                        }
                    } else if(substr($oFile->source_filename, 0, 7) === 'poster_' ||
                        substr($oFile->source_filename, 0, 6) === 'cover_'
                    ) {
                        $oFileController->deleteFile($oFile->file_srl);
                    }
                }
            }
        }

        public static function removeDocumentThumbnailFromContent($oDocument) {
            if($oDocument && $oDocument->isExists()) {
                $documentContent = $oDocument->get('content');
                $document_srl = $oDocument->get('document_srl');
                $oContext = Context::getInstance();
                $requestVars = Context::getRequestVars();
                if(isset($requestVars->content) && $requestVars->content) {
                    $documentContent = $requestVars->content;
                }

                if($documentContent) {
                    $args = new stdClass;
                    $args->document_srl = $document_srl;
                    $args->content = preg_replace("/<!--DocumentThumbnailStart-->.*?<!--DocumentThumbnailEnd-->/", "", $documentContent);
                    $output = executeQuery('addons.simple_mp3_player.updateDocumentContent', $args);
                    if($output->toBool()) {
                        $oContext->set('content', $documentContent, TRUE);
                        $thumbnail_path = sprintf('files/thumbnails/%s', getNumberingPath($document_srl, 3));
                        Filehandler::removeFilesInDir($thumbnail_path);
                    }
                }
            }
        }

        public static function updateDocumentThumbnail($document_srl, $file_srl) {
            $oFileModel = getModel('file');
            $file_info = $oFileModel->getFile($file_srl);

            $args =  new stdClass();
            $args->file_srl = $file_srl;
            $args->upload_target_srl = $document_srl;

            $oDB = &DB::getInstance();
            $oDB->begin();

            $args->cover_image = 'N';
            $output = executeQuery('file.updateClearCoverImage', $args);
            if(!$output->toBool()) {
                $oDB->rollback();
                return $output;
            }
            if($file_info->cover_image != 'Y') {
                $args->cover_image = 'Y';
                $output = executeQuery('file.updateCoverImage', $args);
                if(!$output->toBool()) {
                    $oDB->rollback();
                    return $output;
                }

            }
            $oDB->commit();
            $thumbnail_path = sprintf('files/thumbnails/%s', getNumberingPath($document_srl, 3));
            Filehandler::removeFilesInDir($thumbnail_path);
        }

        public static function isSupportedToSetThumbnail() {
            $oFileController = getController('file');
            return method_exists($oFileController, 'procFileSetCoverImage');
        }

        public static function isNotXSSRequest() {
            $headers = array();
            foreach ($_SERVER as $key => $value) {
                if (strpos($key, 'HTTP_') === 0) {
                    $headers[str_replace(' ', '', ucwords(str_replace('_', ' ', strtolower(substr($key, 5)))))] = $value;
                }
            }

            return (isset($headers['XAddonsXssProtector']) && $headers['XAddonsXssProtector'] === 'OK');
        }

        public static function createVideoThumbnail($uploaded_filename, $ffmpeg_pathname = '/usr/local/ffmpeg', $image_format = 'jpg', $timestampOffset = 0) {
            if($uploaded_filename) {
                $uploaded_filename_pathinfo = pathinfo($uploaded_filename);
                $thumbnail_filename = $uploaded_filename_pathinfo['dirname'] . $uploaded_filename_pathinfo['filename'] . '.'.$image_format;
                $command = $ffmpeg_pathname;
                $command .= " -y";
                if($timestampOffset) {
                    $command .= " -ss ".self::getFFmpegTimeString($timestampOffset);
                }
                $command .= " -i " . escapeshellarg($uploaded_filename);
                $command .= " -vframes 1 " . escapeshellarg($thumbnail_filename);
                $status = @exec($command, $output, $result);
                if($result === 0 && file_exists($thumbnail_filename)) {
                    return $thumbnail_filename;
                }
            }

            return null;
        }

        public static function getFFmpegTimeString($duration) {
            $h = floor($duration / 60 / 60);
            $m = floor($duration / 60) - $h * 60;
            $s = floor($duration % 60);
            $ms = ($duration - (int)$duration) * 1000;

            return sprintf("%02d:%02d:%02d.%03d", $h, $m, $s, $ms);
        }

        public static function isFFmpegExist($ffmpegPathname = '/usr/bin/ffmpeg') {
            $status = @exec($ffmpegPathname." -version", $output, $result);
            return !$result;
        }
    }
}

if(!class_exists('SimpleMP3Describer', false)) {
    class SimpleMP3Describer {
        private $use_encrypt = false;
        private $password = null;
        private $ffmpegNotSupported = false;

        public function __construct($config) {
            if($config === null) {
                $config->password = null;
                $config->buffer_encrypt = false;
                $config->use_encrypt = false;
                $config->password = false;
                $config->encryption_key_update_period = 0;
                $config->is_hls_mode = false;
                $config->allow_m3u8_cors = false;
                $config->use_hls_standard = false;
                $config->use_hls_id3_tag = false;
                $config->use_hls_same_segnature = true;
                $config->include_uploaded_filename = false;
                $config->video_thumbnail = false;
                $config->video_thumbnail_format = 'jpg';
                $config->ffmpeg_pathname = '/usr/bin/ffmpeg';
                $config->video_thumbnail_timestamp_offset = "10%";
            }
            if($config->password) {
                $this->password = $config->password;
            }
            $this->buffer_encrypt = false;

            $this->use_hls_standard = false;
            $this->use_hls_same_segnature = $config->use_hls_same_segnature;
            $this->allow_m3u8_cors = $config->allow_m3u8_cors;

            $this->use_hls_id3_tag = $config->use_hls_id3_tag;
            $this->encryption_key_update_period = 0;
            $this->is_hls_mode = $config->is_hls_mode;
            //$this->include_uploaded_filename = $config->include_uploaded_filename;
            $this->include_uploaded_filename = true;

            $this->video_thumbnail = $config->video_thumbnail;
            $this->video_thumbnail_format = $config->video_thumbnail_format;
            $this->ffmpeg_pathname = $config->ffmpeg_pathname;
            $this->video_thumbnail_timestamp_offset = $config->video_thumbnail_timestamp_offset;

            if($config->use_encrypt && SimpleEncrypt::isEncryptSupported()) {
                $this->use_hls_standard = $config->use_hls_standard;
                $this->use_encrypt = $config->use_encrypt;
                $this->password = $config->password ? $config->password : SimpleEncrypt::getPassword();
                if($config->encryption_key_update_period >= 0) {
                    $this->encryption_key_update_period = $config->encryption_key_update_period;
                    $this->buffer_encrypt = $config->buffer_encrypt;
                }
            }
            if(!$this->use_encrypt) {
                $this->buffer_encrypt = false;
            }

            $this->lastCreatedURL = null;
            $this->lastEncryptedURL = null;
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
                } else if($extension === 'webm') {
                    return 'video/webm';
                } else if($extension === 'mp4') {
                    return 'video/mp4';
                }
            }

            return null;
        }

        private function createMP3URL($uploaded_filename, $args = array()) {
            $argsArr = array();
            if($uploaded_filename) {
                if(!$this->use_encrypt || !$this->is_hls_mode) {
                    return $uploaded_filename;
                }

                if($this->use_encrypt) {
                    if($this->use_hls_same_segnature) {
                        if ($this->lastCreatedURL !== $uploaded_filename) {
                            $this->lastCreatedURL = $uploaded_filename;
                            $this->lastEncryptedURL = $this->getURLEncrypt($uploaded_filename);
                        }

                        $argsArr[] = array('key' => 'Signature', 'value' => $this->lastEncryptedURL);
                    } else {
                        $argsArr[] = array('key'=> 'Signature', 'value' => $this->getURLEncrypt($uploaded_filename));
                    }

                } else {
                    $argsArr[] = array('key'=> 'file', 'value' => $uploaded_filename);
                }
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
            $url .= "&arguments=".urlencode(implode(",", $keys));
            $url .= "&SN=".substr($hash, 0, 24);

            return $url;
        }

        public function getDescriptionsByDocumentSrl($document_srl, $thumbnail_type = 'crop', $thumbnail_width = 420, $thumbnail_height = 420, $segmentDuration = null, $isForce = false) {
            $oDocumentModel = getModel('document');
            $oDocument = $oDocumentModel->getDocument($document_srl);
            if(!$oDocument->isExists() || !($oDocument->isAccessible() || $isForce)) {
                return null;
            }
            $descriptions = array();
            $files = $this->getMultipleFilePathname($document_srl);
            $thumbnail = null;
            if($thumbnail_type && $thumbnail_width > 0&& $thumbnail_height > 0) {
                $documentThumbnail = $oDocument->getThumbnail($thumbnail_width, $thumbnail_height, $thumbnail_type);
                if($oDocument->thumbnailExists($thumbnail_width, $thumbnail_height, $thumbnail_type) && $documentThumbnail) {
                    $thumbnail = $documentThumbnail;
                }
            }
            if($files) {
                foreach($files as $file) {
                    $description = $this->getDescription($file->file_srl, $file->uploaded_filename, $file->source_filename, $document_srl, $file->sid, $file->module_srl, $segmentDuration);
                    if($description) {
                        $this->normalizeDescription($description, $document_srl, $file->file_srl);
                        $description->thumbnail = $thumbnail;
                        $description->editable = $oDocument->isGranted();
                    } else {
                        continue;
                    }
                    $obj = new stdClass;
                    $obj->file_srl = $file->file_srl;
                    $obj->description = $description;
                    $descriptions[] = $obj;
                }
            }

            return $descriptions;
        }

        public function normalizeDescription($description, $document_srl, $file_srl, $preserveOffsetList = false) {
            if($description && isset($description->filePath) && $description->filePath) {
                $filepath = $description->filePath;;
                $timestamp = time();
                $fileParts = pathinfo($description->filePath);
                $ip = $_SERVER['REMOTE_ADDR'];
                $sourceFileParts = pathinfo($description->filename);
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
                if($this->include_uploaded_filename) {
                    $description->uploaded_filename = $filepath;
                }
                if($description->offsetInfo) {
                    $offsetInfo = $description->offsetInfo;
                    $offsets = $offsetInfo->offsets;
                    $duration = $offsetInfo->duration;
                    $offsetSize = count($offsets);
                    $streamStartOffset = $offsets[0]->startOffset;
                    $streamEndOffset = $offsets[$offsetSize-1]->endOffset;
                    if($this->use_encrypt) {
                        if(!$this->is_hls_mode) {
                            $description->filePath = $this->createMP3URL($filepath, array(
                                array('key'=>'streamStartOffset', 'value'=>$streamStartOffset),
                                array('key'=>'streamEndOffset', 'value'=>$streamEndOffset),
                                array('key'=>'document_srl', 'value'=>$document_srl),
                                array('key'=>'file_srl', 'value'=>$file_srl),
                                array('key'=>'mime', 'value'=>$mime),
                                array('key'=>'duration', 'value'=>round($duration, 2)),
                                array('key'=>'timestamp', 'value'=>$timestamp),
                                array('key'=>'type', 'value'=>'progressive')
                            ));
                        } else {
                            unset($description->filePath);
                        }
                        if($this->is_hls_mode) {
                            if(!$this->use_hls_standard || $preserveOffsetList) {
                                $rotationCount = 0;
                                $lastHandshake = null;
                                foreach ($offsets as $idx=>$eachOffset) {
                                    $urlParamArr = array(
                                        array('key'=>'document_srl', 'value'=>$document_srl),
                                        array('key'=>'file_srl', 'value'=>$file_srl),
                                        array('key'=>'streamStartOffset', 'value'=>$streamStartOffset),
                                        array('key'=>'streamEndOffset', 'value'=>$streamEndOffset),
                                        array('key'=>'mime', 'value'=>$mime),
                                        array('key'=>'start', 'value'=>$eachOffset->startOffset),
                                        array('key'=>'end', 'value'=>$eachOffset->endOffset),
                                        array('key'=>'duration', 'value'=> floor($duration*100000) / 100000),
                                        array('key'=>'ip', 'value'=>$ip),
                                        array('key'=>'offset', 'value'=> floor($eachOffset->timestampOffset * 100000) / 100000),
                                        array('key'=>'timestamp', 'value'=>$timestamp),
                                        array('key'=>'type', 'value'=>'realtime')
                                    );

                                    if($this->use_hls_standard) {
                                        $urlParamArr[] = array('key'=>'seq', 'value'=>$idx);
                                    }
                                    if(!$this->use_hls_id3_tag) {
                                        $urlParamArr[] = array('key'=>'id3', 'value'=>0);
                                    }
                                    if($this->allow_m3u8_cors) {
                                        $urlParamArr[] = array('key'=>'cors', 'value'=>1);
                                    }

                                    if($this->buffer_encrypt) {
                                        if(!$lastHandshake) {
                                            $lastHandshake = SimpleEncrypt::getRandomStr(16);
                                        }
                                        if($rotationCount === 0 ||
                                            ($this->encryption_key_update_period > 0 && $rotationCount % $this->encryption_key_update_period === 0)
                                        ) {
                                            if($rotationCount > 0) {
                                                $lastHandshake = SimpleEncrypt::getRandomStr(16);
                                            }
                                            $publicKey = SimpleEncrypt::getEncrypt(SimpleEncrypt::getBufferPublicKey($this->password, $lastHandshake), $this->password);
                                            $keyUrlParamArr = array(
                                                array('key'=>'Public', 'value'=> $publicKey),
                                                array('key'=>'document_srl', 'value'=>$document_srl),
                                                array('key'=>'file_srl', 'value'=>$file_srl),
                                                array('key'=>'ip', 'value'=>$ip),
                                                array('key'=>'timestamp', 'value'=>$timestamp),
                                                array('key'=>'handshake', 'value' => $lastHandshake)
                                            );
                                            if($this->use_hls_standard && $this->allow_m3u8_cors) {
                                                $keyUrlParamArr[] = array('key'=>'cors', 'value'=>1);
                                            }
                                            $eachOffset->key = $this->createMP3URL(null, $keyUrlParamArr);
                                        }
                                        $rotationCount++;
                                        $urlParamArr[] = array('key'=>'handshake', 'value' => $lastHandshake);
                                    }

                                    $eachOffset->url = $this->createMP3URL($filepath, $urlParamArr);
                                }
                            } else {
                                $mid = Context::get('mid');
                                $description->offsetInfo = null;
                                if($mid) {
                                    $description->m3u8link = getNotEncodedUrl('', 'act', 'getSimpleMP3M3U8', 'mid', $mid, 'document_srl', $document_srl,'file_srl', $file_srl);
                                } else {
                                    $description->m3u8link = getNotEncodedUrl('', 'act', 'getSimpleMP3M3U8', 'document_srl', $document_srl,'file_srl', $file_srl);
                                }
                            }

                        }
                    }

                    $offsetInfo->encrypted = $this->use_encrypt && $this->buffer_encrypt;
                } else {
                    $arguments = array(
                        array('key'=>'document_srl', 'value'=>$document_srl),
                        array('key'=>'file_srl', 'value'=>$file_srl),
                        array('key'=>'mime', 'value'=>$mime),
                        array('key'=>'ip', 'value'=>$ip),
                        array('key'=>'timestamp', 'value'=>$timestamp),
                        array('key'=>'type', 'value'=>'progressive')
                    );
                    if(isset($description->stream)) {
                        $stream = $description->stream;
                        if(isset($stream->duration)) {
                            $arguments[] = array('key'=>'duration', 'value'=>round($stream->duration, 2));
                        }
                    }

                    $description->filePath = $this->createMP3URL($filepath, $arguments);
                }
            }
        }

        function getDescription($file_srl, $uploaded_filename, $source_filename, $document_srl = null, $file_sid = null, $module_srl = null, $segmentDuration = null) {
            $description = self::getDescriptionFile($file_srl, $uploaded_filename);
            if($description && (!isset($description->version) || $description->version !== self::getDescriptionVersion())) {
                $description = null;
            }
            if($description && isset($description->offsetInfo) && $description->offsetInfo && is_array($segmentDuration) && count($segmentDuration) > 0) {
                $offsetInfo = $description->offsetInfo;
                if(isset($offsetInfo->segmentDuration) && is_array($offsetInfo->segmentDuration) && count($offsetInfo->segmentDuration) === count($segmentDuration)) {
                    foreach($segmentDuration as $key=>$val) {
                        if($val !== $offsetInfo->segmentDuration[$key]) {
                            $description = null;
                            break;
                        }
                    }
                } else {
                    $description = null;
                }
            }
            if(!$description) {
                $description = $this->getMP3DescriptionFromOrigin($document_srl, $file_srl, $source_filename, $uploaded_filename, $segmentDuration);
            }
            if($description) {
                if($file_srl) {
                    $description->file_srl = $file_srl;
                    if ($file_sid && $module_srl) {
                        $oFileModel = getModel('file');
                        $description->download_url = $oFileModel->getDownloadUrl($file_srl, $file_sid, $module_srl);
                    }
                }
                $document_srl = (int)$document_srl;
                if($document_srl) {
                    $description->document_srl = $document_srl;
                }
            }


            return $description;
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

        static function getDescriptionFile($file_srl, $pathname) {
            $basePath = self::getDescriptionFilePath($file_srl, $pathname);
            if($basePath) {
                $description = FileHandler::readFile($basePath."description.json");
                if($description) {
                    return json_decode($description);
                }
            }

            return null;
        }

        static function getDescriptionVersion() {
            return '0.0.3';
        }

        static function getM3U8Playlist ($description) {
            if($description && $description->offsetInfo) {
                $targetduration = 0;
                $offsets = $description->offsetInfo->offsets;

                $m3u8 = array();
                foreach($offsets as $offset) {
                    if($offset->time > $targetduration) {
                        $targetduration = ceil($offset->time);
                    }
                    if($offset->key) {
                        $m3u8[] = '#EXT-X-KEY:METHOD=AES-128,URI="' . $offset->key . '"';
                    }
                    $m3u8[] = '#EXTINF:' . (floor($offset->time*1000)/1000) . ",";
                    $m3u8[] = $offset->url;
                }

                $m3u8 = array_merge(
                    array('#EXTM3U',
                        '#EXT-X-VERSION:6',
                        '#EXT-X-PLAYLIST-TYPE:VOD',
                        '#EXT-X-TARGETDURATION:'.$targetduration,
                        '#EXT-X-MEDIA-SEQUENCE:0'
                    ), $m3u8);

                $m3u8[] = '#EXT-X-ENDLIST';

                return implode("\n", $m3u8);
            }

            return null;
        }

        function getMP3DescriptionFromOrigin($document_srl, $file_srl, $source_filename = null, $filepath = null, $segmentDuration = null) {
            if(!$filepath) {
                $filepathData = self::getFilePathname($file_srl, $document_srl);
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
            if(!in_array($extension, array('mp3', 'm4a', 'flac', 'ogg', 'mp4', 'webm'))) {
                return null;
            }

            $mp3Spec = self::getMP3Sepc($filepath);
            $tags = $mp3Spec ? $mp3Spec->tags : null;
            $stream = $mp3Spec ? $mp3Spec->stream : null;
            $obj = new stdClass();
            $obj->document_srl = $document_srl;
            $obj->file_srl = $file_srl;
            $obj->filePath = $filepath;
            $obj->filename = $source_filename;
            $obj->offsetInfo = null;
            $obj->tags = $tags;
            $obj->stream = $stream;
            $obj->isValidFile = !!($stream && $stream->fileformat);
            $obj->version = self::getDescriptionVersion();
            $obj->poster = null;
            if(($stream && $stream->fileformat === 'mp3') || (!$stream && $extension === 'mp3')) {
                $offsets = self::getSplitPosition($filepath, $segmentDuration);
                $obj->isValidFile = !!(isset($offsets->duration) && $offsets->duration > 2);
                $obj->offsetInfo = $offsets;
            }
            if($stream && in_array($stream->fileformat, array('mp4', 'webm'))) {
                $obj->poster = $this->createVideoThumbnail($filepath, $descriptionFilePath, $stream->duration);
            }

            return self::createDescriptionFile($obj, $descriptionFilePath);
        }

        function createVideoThumbnail($uploaded_filename, $descriptionFilePath, $totalDuration = 0) {
            if(!FileHandler::makeDir($descriptionFilePath) || !$this->video_thumbnail) {
                return null;
            }

            $thumbnailPathname = SimpleMP3Tools::createVideoThumbnail($uploaded_filename, $this->ffmpeg_pathname, $this->video_thumbnail_format, self::parseDuration($totalDuration, $this->video_thumbnail_timestamp_offset));
            if($thumbnailPathname) {
                $posterBinary = FileHandler::readFile($thumbnailPathname);
                if($posterBinary) {
                    FileHandler::removeFile($thumbnailPathname);
                    $obj = new stdClass;
                    $obj->data = $posterBinary;
                    $obj->format = $this->video_thumbnail_format;
                    return $obj;
                }
            }

            return null;
        }

        static function parseDuration($duration, $offsetString) {
            $duration = (int)$duration;
            $timestampOffset = 0;
            $isRelativeOffset = strpos($offsetString, "%");
            if($isRelativeOffset > -1) {
                preg_match("/^([0-9]+)%$/", $offsetString, $matches);
                if($matches && count($matches) > 1) {
                    $timestampOffset = (int)$matches[1] * $duration / 100;
                }
            } else if(is_numeric($offsetString)) {
                $timestampOffset = (int)$offsetString;
                if($timestampOffset < 0) {
                    $timestampOffset = $duration - $timestampOffset;
                }
            }

            return $duration && $timestampOffset ? min($duration*0.99, $timestampOffset) : 0;
        }

        static function createDescriptionFile($originDescription = null, $savePath) {
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
                $poster = $originDescription->poster;
                unset($originDescription->poster);
                $poster_pathname = null;
                if($poster && $poster->format) {
                    $poster_pathname = $savePath."poster.".$poster->format;
                    FileHandler::writeFile($poster_pathname, $poster->data);
                }
                $originDescription->poster = $poster_pathname;

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

        static function getSplitPosition($pathname, $segmentDuration = null) {
            try {
                $segmentDuration = is_array($segmentDuration) && count($segmentDuration) > 0 ? $segmentDuration : array(2,3,10);
                $mp3 = new PHPMP3($pathname);
                $offsets = $mp3->getSplitPosition($segmentDuration);
                if(count($offsets) < 3) {
                    return null;
                }

                $duration = 0;
                foreach($offsets as $key=>$value) {
                    $duration += $value->time;
                }

                $obj = new stdClass;
                $obj->duration = $duration;
                $obj->segmentDuration = $segmentDuration;
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
                $oFileList = $oFileModel->getFiles($upload_target_srl, array('file_srl', 'uploaded_filename', 'source_filename', 'module_srl', 'sid'));
                if($oFileList) {
                    return $oFileList;
                }
            }

            return array();
        }

        static function getFilePathname($file_srl, $upload_target_srl = null) {
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

        static function getStreamInfo($analyzedID3) {
            $stream = new stdClass;
            $stream->isAudio = false;
            $stream->isVideo = false;
            $stream->filesize = null;
            $stream->fileformat = null;
            $stream->duration = null;
            $stream->bitrate = null;
            $stream->video = null;
            $stream->audio = null;
            $stream->mime = null;
            if($analyzedID3 && gettype($analyzedID3) === 'array') {
                $streamKeys = array('filesize' => 'filesize',
                    'fileformat' => 'fileformat',
                    'avdataoffset' => 'startoffset',
                    'avdataend' => 'endoffset',
                    'playtime_seconds' => 'duration',
                    'bitrate' => 'bitrate',
                    'mime_type' => 'mime',
                    'encoding' => 'encoding',
                );
                foreach($streamKeys as $key=>$value) {
                    if(isset($analyzedID3[$key]) && $analyzedID3[$key] && $value) {
                        $stream->{$value} = $analyzedID3[$key];
                    }
                }
                $audio = isset($analyzedID3['audio']) && is_array($analyzedID3['audio']) && $analyzedID3['audio'] ? $analyzedID3['audio'] : null;
                $video = isset($analyzedID3['video']) && is_array($analyzedID3['video']) && $analyzedID3['video'] ? $analyzedID3['video'] : null;
                if($audio && count($audio) > 0) {
                    $stream->isAudio = true;
                    $audioStreams = isset($audio['streams']) && is_array($audio['streams']) && count($audio['streams']) > 0 ? $audio['streams'] : null;
                    if($audioStreams) {
                        $stream->audio = array();
                        foreach($audioStreams as $eachAudioStream) {
                            $obj = new stdClass;
                            foreach($eachAudioStream as $key=>$value) {
                                if(gettype($value) === 'number' || $value === null) {
                                    $obj->{$key} = $value;
                                } else {
                                    $obj->{$key} = !is_bool($value) ? base64_encode($value) : $value;
                                }
                            }
                            $stream->audio[] = $obj;
                        }
                    }
                }
                if($video) {
                    $videoObj = new stdClass;
                    $stream->isVideo = true;
                    $stream->video = $videoObj;
                    foreach($video as $key=>$value) {
                        $videoObj->{$key} = base64_encode($value);
                    }
                }
            }

            return $stream;
        }

        static function getMP3Sepc($mp3Pathname) {
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
                $stream = self::getStreamInfo($ThisFileInfo);
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
                        $targetTags = array('title' => 'title',
                            'artist' => 'artist',
                            'album' => 'album',
                            'band' => 'albumartist',
                            'album_artist' => 'albumartist',
                            'content_group_description' => 'contentgroup',
                            'genre' => 'genre',
                            'part_of_a_set' => 'discnumber',
                            'totaltracks' => 'totaltracks',
                            'track_number' => 'tracknumber',
                            'creation_date' => 'year',
                            'year' => 'year',
                            'length' => 'length',
                            'publisher' => 'publisher',
                            'composer' => 'composer',
                            'conductor' => 'conductor',
                            'copyright_message' => 'copyright',
                            'copyright' => 'copyright',
                            'comment' => 'comment',
                            'unsynchronised_lyric' => 'unsyncedlyrics',
                            'url_user' => 'www',
                            'encoding_tool' => 'encoding_tool',
                            'encoder_settings' => 'encodersettings',
                            'encoded_by' => 'encoded_by'
                        );

                        foreach($targetTags as $key=>$value) {
                            if(isset($tagTraget[$key]) && count($tagTraget[$key]) && $tagTraget[$key][0]) {
                                $eachValue = removeHackTag($tagTraget[$key][0]);
                                $tags->{$value} = gettype($eachValue) === 'number' || is_bool($eachValue) || $eachValue === null  ? $eachValue : base64_encode($eachValue);
                            }
                        }
                        $id3v2 = isset($ThisFileInfo['id3v2']) && $ThisFileInfo['id3v2'] ? $ThisFileInfo['id3v2'] : null;
                        if($id3v2) {
                            if(isset($id3v2['UFID']) && $id3v2['UFID']) {
                                $ufid = is_array($id3v2['UFID']) ? $id3v2['UFID'] : array($id3v2['UFID']);
                                if(count($ufid) > 0 && $ufid[0] && isset($ufid[0]['data']) && isset($ufid[0]['ownerid'])) {
                                    $ufidObj = new stdClass;
                                    $ufidObj->data = base64_encode($ufid[0]['data']);
                                    $ufidObj->ownerID = base64_encode($ufid[0]['ownerid']);
                                    $tags->uniquefileid = $ufidObj;
                                }
                            }
                            if(isset($id3v2['PRIV']) && $id3v2['PRIV']) {
                                $priv = is_array($id3v2['PRIV']) ? $id3v2['PRIV'] : array($id3v2['PRIV']);
                                $tags->priv = array();
                                foreach($priv as $eachPriv) {
                                    if($eachPriv && isset($eachPriv['data']) && isset($eachPriv['ownerid'])) {
                                        $privObj = new stdClass;
                                        $privObj->data = base64_encode($eachPriv['data']);
                                        $privObj->ownerID = base64_encode($eachPriv['ownerid']);
                                        $tags->priv[] = $privObj;
                                    }
                                }
                            }
                            if(isset($id3v2['COMM']) && $id3v2['COMM']) {
                                $comm = is_array($id3v2['COMM']) ? $id3v2['COMM'] : array($id3v2['COMM']);
                                $tags->comm = array();
                                foreach($comm as $eachComm) {
                                    if($eachComm && isset($eachComm['description']) && isset($eachComm['data'])) {
                                        $commObj = new stdClass;
                                        $commObj->data = $eachComm['data'] ? base64_encode($eachComm['data']) : null;
                                        $commObj->description = $eachComm['description'] ? base64_encode($eachComm['description']) : null;
                                        $tags->comm[] = $commObj;
                                    }
                                }
                            }
                        }
                    }
                }
                if(isset($ThisFileInfo['comments']) && isset($ThisFileInfo['comments']['picture']) && count($ThisFileInfo['comments']['picture'])) {
                    $tags->albumArt = $ThisFileInfo['comments']['picture'][0];
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

        public static function isAccessibleDocument($document_srl) {
            if($document_srl) {
                $oDocumentModel = getModel('document');
                $oDocument = $oDocumentModel->getDocument($document_srl);
                if($oDocument->isExists()) {
                    if($oDocument->isAccessible() || $oDocument->isGranted()) {
                        return true;
                    }
                    $oModuleModel = getModel('module');
                    $module_info = $oModuleModel->getModuleInfoByDocumentSrl($document_srl);
                    $member_info = Context::get('logged_info');
                    if(!$member_info) {
                        $member_info = new stdClass;
                        $member_info->is_admin = "N";
                        $member_info->member_srl = null;
                    }
                    $oModuleGrant = $oModuleModel->getGrant($module_info, $member_info);
                    if($oDocument->isSecret()) {
                        if($oModuleGrant->manager || $member_info->is_admin === "Y") {
                            return true;
                        }
                    } else if($oModuleGrant->access && $oModuleGrant->view) {
                        return true;
                    }
                }
            }

            return false;
        }


        public static function getALSongLyric($file_srl, $expire = 72, $renewDuration = 30) {
            $oFileModel = getModel('file');
            $oFile = $oFileModel->getFile($file_srl);
            if($oFile) {
                $upload_target_srl = $oFile->upload_target_srl;
                $isAccessableDocument = self::isAccessibleDocument($upload_target_srl);
                if(!$isAccessableDocument) {
                    return null;
                }
                $description = self::getDescription($file_srl, $oFile->uploaded_filename, $oFile->source_filename, $upload_target_srl);
                if($description) {
                    $lyricFromFile = self::getALSongLyricFromFile($file_srl, $oFile->uploaded_filename);
                    $lyricFileExists = false;
                    $requireRenew = false;
                    if($lyricFromFile) {
                        $lyricFileExists = true;
                        if($lyricFromFile->lyric) {
                            if($lyricFromFile->birthtime + $expire*60*60 > time()) {
                                return $lyricFromFile->lyric;
                            } else {
                                $requireRenew = true;
                            }
                        } else if($lyricFromFile->lyric === null && $lyricFromFile->birthtime + $renewDuration * 60 > time()) {
                            return null;
                        }
                    }

                    $startOffset = null;
                    $stream = isset($description->stream) && $description->stream ? $description->stream : null;
                    $offsetInfo = isset($description->offsetInfo) && $description->offsetInfo ? $description->offsetInfo : null;
                    if($offsetInfo !== null) {
                        $offsets = isset($offsetInfo->offsets) && $offsetInfo->offsets ? $offsetInfo->offsets : null;
                        if($offsets && is_array($offsets) && count($offsets) > 10) {
                            $startOffset = $offsets[0]->startOffset;
                        }
                    }
                    if(!$startOffset && $stream !== null && $stream->fileformat === "mp4" && isset($stream->startoffset) && $stream->startoffset > 8) {
                        $startOffset = $stream->startoffset - 8;
                    }
                    if($startOffset !== null) {
                        $md5 = self::getALSongLyricHash($oFile->uploaded_filename, $startOffset);
                        if($md5) {
                            $lyric = self::getALSongLyricFromServer($md5);
                            if(!lyric && $requireRenew) {
                                $lyric = $lyricFromFile->lyric;
                            }

                            self::createALSongLyricFile($file_srl, $oFile->uploaded_filename, $lyric);

                            if($lyric) {
                                return $lyric;
                            } else if($lyricFileExists && isset($lyricFromFile->lyric)) {
                                return $lyricFromFile->lyric;
                            } else {
                                return null;
                            }
                        }
                    }
                }
            }

            return null;
        }

        public static function getALSongLyricHash($filepath, $startOffset) {
            if(file_exists($filepath)) {
                $filesize = filesize($filepath);
                if($filesize-$startOffset < 163840) {
                    return null;
                }

                $fd = fopen($filepath, "rb");
                fseek($fd, $startOffset, SEEK_SET);
                $hash = md5(fread($fd, 163840));
                fclose($fd);

                return $hash;
            }

            return null;
        }

        public static function createALSongLyricFile($file_srl, $uploaded_filename, $lyric = null) {
            $basepath = self::getDescriptionFilePath($file_srl, $uploaded_filename);
            $lrcFilename = $basepath.'lyric.json';
            if($basepath) {
                if(file_exists($lrcFilename)) {
                    FileHandler::removeFile($lrcFilename);
                }
                $obj = new stdClass;
                $obj->file_srl = $file_srl;
                $obj->lyric = $lyric;
                $obj->birthtime = time();
                $json = json_encode($obj);
                FileHandler::writeFile($lrcFilename, $json);
            }
        }

        public static function getALSongLyricFromFile($file_srl, $uploaded_filename) {
            $basepath = self::getDescriptionFilePath($file_srl, $uploaded_filename);
            $lrcFilename = $basepath.'lyric.json';
            if($basepath) {
                if (file_exists($lrcFilename)) {
                    $lrcJSON = FileHandler::readFile($lrcFilename);
                    if($lrcJSON) {
                        try {
                            return json_decode($lrcJSON);
                        } catch(Exception $e) {}
                    }
                }
            }

            return null;
        }

        public static function getALSongLyricFromServer($md5) {
            $url = '/alsongwebservice/service1.asmx';
            $xml = '<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ns2="ALSongWebServer/Service1Soap" xmlns:ns1="ALSongWebServer" xmlns:ns3="ALSongWebServer/Service1Soap12">
<SOAP-ENV:Body>
<ns1:GetLyric7>
<ns1:encData>7c2d15b8f51ac2f3b2a37d7a445c3158455defb8a58d621eb77a3ff8ae4921318e49cefe24e515f79892a4c29c9a3e204358698c1cfe79c151c04f9561e945096ccd1d1c0a8d8f265a2f3fa7995939b21d8f663b246bbc433c7589da7e68047524b80e16f9671b6ea0faaf9d6cde1b7dbcf1b89aa8a1d67a8bbc566664342e12</ns1:encData>
<ns1:stQuery><ns1:strChecksum>'.$md5.'</ns1:strChecksum><ns1:strVersion></ns1:strVersion><ns1:strMACAddress></ns1:strMACAddress><ns1:strIPAddress>192.168.1.5</ns1:strIPAddress></ns1:stQuery></ns1:GetLyric7></SOAP-ENV:Body></SOAP-ENV:Envelope>';

            $client = new HttpClient('lyrics.alsong.co.kr');
            $client->post($url, $xml);
            $content = $client->getContent();
            preg_match('/<strLyric>(.*)?<\/strLyric>/i', $content, $lyricHTML);
            if($lyricHTML && is_array($lyricHTML) && count($lyricHTML) === 2 && $lyricHTML[1]) {
                $lrc = $lyricHTML[1];
                $lrc = str_replace('&lt;br&gt;',"\n",$lrc);
                return $lrc;
            }

            return null;
        }

    }
}





// !!! 애드온 설정 시작.

$act = Context::get('act');
$config = new stdClass();
$config->use_mediasession = !(isset($addon_info->use_mediasession) && $addon_info->use_mediasession === "N");
$config->mediasession_forward_time = isset($addon_info->mediasession_forward_time) && (int)$addon_info->mediasession_forward_time >= 0 ? $addon_info->mediasession_forward_time : 20;
$config->mediasession_backward_time = isset($addon_info->mediasession_backward_time) && (int)$addon_info->mediasession_backward_time >= 0 ? $addon_info->mediasession_backward_time : 20;
$config->use_url_encrypt = !(isset($addon_info->use_url_encrypt) && $addon_info->use_url_encrypt === "N");
$config->allow_autoplay = !(isset($addon_info->allow_autoplay) && $addon_info->allow_autoplay === "N");
$config->link_to_media = (isset($addon_info->link_to_media) && $addon_info->link_to_media === "Y");
$config->default_cover = isset($addon_info->default_cover) && $addon_info->default_cover ? $addon_info->default_cover : null;
$config->playlist_player_selector = isset($addon_info->playlist_player_selector) ? $addon_info->playlist_player_selector : null;
$config->use_thumbnail = !(isset($addon_info->use_thumbnail) && $addon_info->use_thumbnail === "N");
$config->thumbnail_type = isset($addon_info->thumbnail_type) && $addon_info->thumbnail_type ? $addon_info->thumbnail_type : 'crop';
$config->thumbnail_width = isset($addon_info->thumbnail_width) && $addon_info->thumbnail_width ? $addon_info->thumbnail_width : 420;
$config->thumbnail_height = isset($addon_info->thumbnail_height) && $addon_info->thumbnail_height ? $addon_info->thumbnail_height : 420;

$config->BluePlayer__use_autostation = !(isset($addon_info->BluePlayer__use_autostation) && $addon_info->BluePlayer__use_autostation === "N");
$config->BluePlayer__autostation_max_size = isset($addon_info->BluePlayer__autostation_max_size) && $addon_info->BluePlayer__autostation_max_size ? $addon_info->BluePlayer__autostation_max_size : 0;
$config->BluePlayer__autostation_search_filter = !(isset($addon_info->BluePlayer__autostation_search_filter) && $addon_info->BluePlayer__autostation_search_filter === "N");
$config->BluePlayer__track_mode = isset($addon_info->BluePlayer__track_mode) && $addon_info->BluePlayer__track_mode ? $addon_info->BluePlayer__track_mode : "RepeatList";
$config->BluePlayer__track_random = (isset($addon_info->BluePlayer__track_random) && $addon_info->BluePlayer__track_random === "Y");
$config->BluePlayer__track_random_force = (isset($addon_info->BluePlayer__track_random_force) && $addon_info->BluePlayer__track_random_force === "Y");
$config->BluePlayer_show_album_name = (isset($addon_info->BluePlayer_show_album_name) && $addon_info->BluePlayer_show_album_name === "Y");
$config->BluePlayer_enable_download = !(isset($addon_info->BluePlayer_enable_download) && $addon_info->BluePlayer_enable_download === "N");
$config->BluePlayer_enable_thumbnail_button = !(isset($addon_info->BluePlayer_enable_thumbnail_button) && $addon_info->BluePlayer_enable_thumbnail_button === "N");
$config->BluePlayer_enable_fade = (isset($addon_info->BluePlayer_enable_fade) && $addon_info->BluePlayer_enable_fade === "Y");
$config->BluePlayer_fade_duration = isset($addon_info->BluePlayer_fade_duration) && $addon_info->BluePlayer_fade_duration ? (int)$addon_info->BluePlayer_fade_duration : 200;

$config->use_mp3_realtime_streaming = !(isset($addon_info->use_mp3_realtime_streaming) && $addon_info->use_mp3_realtime_streaming === "N");
$config->use_hls_standard = !(isset($addon_info->use_hls_standard) && $addon_info->use_hls_standard === "N");
$config->m3u8_gzip_compress = !(isset($addon_info->m3u8_gzip_compress) && $addon_info->m3u8_gzip_compress === "N");
$config->use_hls_id3_tag = !(isset($addon_info->use_hls_id3_tag) && $addon_info->use_hls_id3_tag === "N");
$config->use_hls_same_segnature = !(isset($addon_info->use_hls_same_segnature) && $addon_info->use_hls_same_segnature === "N");
$config->allow_m3u8_cors = (isset($addon_info->allow_m3u8_cors) && $addon_info->allow_m3u8_cors === "Y");
$config->mp3_realtime_buffer_size = isset($addon_info->mp3_realtime_buffer_size) && $addon_info->mp3_realtime_buffer_size ? (int)$addon_info->mp3_realtime_buffer_size : 50;
$config->mp3_realtime_segment_duration = isset($addon_info->mp3_realtime_segment_duration) && $addon_info->mp3_realtime_segment_duration ? $addon_info->mp3_realtime_segment_duration : null;
$config->mp3_realtime_buffer_cache_size = isset($addon_info->mp3_realtime_buffer_cache_size) ? (int)$addon_info->mp3_realtime_buffer_cache_size : 150000000;
$config->mp3_realtime_encrypt = !(isset($addon_info->mp3_realtime_encrypt) && $addon_info->mp3_realtime_encrypt === "N");
$config->mp3_realtime_encryption_key_rotation_period = isset($addon_info->mp3_realtime_encryption_key_rotation_period) && (int)$addon_info->mp3_realtime_encryption_key_rotation_period > 0 ? (int)$addon_info->mp3_realtime_encryption_key_rotation_period : 0;
$config->remove_extension_in_title = !(isset($addon_info->remove_extension_in_title) && $addon_info->remove_extension_in_title === "N");

$config->enable_video = (isset($addon_info->enable_video) && $addon_info->enable_video === "Y");
//$config->enable_webm = (isset($addon_info->enable_webm) && $addon_info->enable_webm === "Y");
$config->enable_webm = true;
$config->video_autoplay = !(isset($addon_info->video_autoplay) && $addon_info->video_autoplay === "N");
$config->video_autoplay_without_audio = !(isset($addon_info->video_autoplay_without_audio) && $addon_info->video_autoplay_without_audio === "N");
$config->video_loop = (isset($addon_info->video_loop) && $addon_info->video_loop === "Y");
$config->video_loop_without_audio = !(isset($addon_info->video_loop_without_audio) && $addon_info->video_loop_without_audio === "N");
$config->video_playsinline = !(isset($addon_info->video_playsinline) && $addon_info->video_playsinline === "N");
$config->video_gif_without_audio = !(isset($addon_info->video_gif_without_audio) && $addon_info->video_gif_without_audio === "N");
$config->video_gif_mode_if_click = !(isset($addon_info->video_gif_mode_if_click) && $addon_info->video_gif_mode_if_click === "N");
$config->video_preload = isset($addon_info->video_preload) && $addon_info->video_preload ? $addon_info->video_preload : 'metadata';
$config->video_resize = !(isset($addon_info->video_resize) && $addon_info->video_resize === "N");
$config->video_auto_attach = (isset($addon_info->video_auto_attach) && $addon_info->video_auto_attach === "Y");


$config->video_thumbnail = !(isset($addon_info->video_thumbnail) && $addon_info->video_thumbnail === "N");
$config->video_thumbnail_format = isset($addon_info->video_thumbnail_format) && $addon_info->video_thumbnail_format ? $addon_info->video_thumbnail_format : 'jpg';
$config->video_thumbnail_poster = !(isset($addon_info->video_thumbnail_poster) && $addon_info->video_thumbnail_poster === "N");
$config->video_thumbnail_timestamp_offset = isset($addon_info->video_thumbnail_timestamp_offset) && $addon_info->video_thumbnail_timestamp_offset ? $addon_info->video_thumbnail_timestamp_offset : '10%';
$config->ffmpeg_pathname = isset($addon_info->ffmpeg_pathname) && $addon_info->ffmpeg_pathname ? $addon_info->ffmpeg_pathname : '/usr/bin/ffmpeg';

$config->document_thumbnail = !(isset($addon_info->document_thumbnail) && $addon_info->document_thumbnail === "N");
$config->document_thumbnail_insert_type = isset($addon_info->document_thumbnail_insert_type) && $addon_info->document_thumbnail_insert_type ? $addon_info->document_thumbnail_insert_type : 'insert_image_hide';
$config->is_supported_to_set_thumbnail = SimpleMP3Tools::isSupportedToSetThumbnail();
$config->library_mode = (isset($addon_info->library_mode) && $addon_info->library_mode === "Y");

//이전 코드 호환용
$config->use_lyric = true;
$config->use_m_lyric = true;
$config->lyric_cache_expire = isset($addon_info->lyric_cache_expire) && $addon_info->lyric_cache_expire ? $addon_info->lyric_cache_expire : 0;
$config->lyric_cache_retry_duration = isset($addon_info->lyric_cache_retry_duration) && $addon_info->lyric_cache_retry_duration ? $addon_info->lyric_cache_retry_duration : 0;
$config->isMobile = Mobile::isFromMobilePhone();
if(!$config->default_cover) {
    $config->default_cover = './addons/simple_mp3_player/img/no_cover.png';
}
if(!$config->playlist_player_selector) {
    $config->playlist_player_selector = '.simple_mp3_player';
}
if(!$config->mp3_realtime_buffer_size || $config->mp3_realtime_buffer_size < 1) {
    $config->mp3_realtime_buffer_size = 12;
}
if($config->mp3_realtime_buffer_size > 180) {
    $config->mp3_realtime_buffer_size = 180;
}
if($config->mp3_realtime_segment_duration) {
    $splitSegmentDuration = explode(',', $config->mp3_realtime_segment_duration);
    $newSegmentDuration = array();
    foreach ($splitSegmentDuration as $each) {
        $eachSegmentDuration = (int)trim($each);
        if($eachSegmentDuration>0) {
            $newSegmentDuration[] = $eachSegmentDuration;
        }
    }
    $config->mp3_realtime_segment_duration = count($newSegmentDuration) > 0 ? $newSegmentDuration : null;
}
if(!$config->mp3_realtime_segment_duration) {
    $config->mp3_realtime_segment_duration = array(2, 3, 5);
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
    $config->mp3_realtime_encrypt = false;
}
if( !$config->use_url_encrypt || !$password) {
    $config->use_hls_standard = false;
}

// !!! 애드온 설정 끝.





$SimpleMP3DescriberConfig = new stdClass;
$SimpleMP3DescriberConfig->use_encrypt = $config->use_url_encrypt;
$SimpleMP3DescriberConfig->buffer_encrypt = $config->mp3_realtime_encrypt;
$SimpleMP3DescriberConfig->use_hls_standard = $config->use_hls_standard;
$SimpleMP3DescriberConfig->use_hls_id3_tag = $config->use_hls_id3_tag;
$SimpleMP3DescriberConfig->use_hls_same_segnature = $config->use_hls_same_segnature;
$SimpleMP3DescriberConfig->allow_m3u8_cors =$config->allow_m3u8_cors;

$SimpleMP3DescriberConfig->password = $password;
$SimpleMP3DescriberConfig->encryption_key_update_period = $config->mp3_realtime_encryption_key_rotation_period;
$SimpleMP3DescriberConfig->is_hls_mode = !(isset($_GET['hls']) && $_GET['hls'] === 'false');
$SimpleMP3DescriberConfig->include_uploaded_filename = $config->link_to_media;
$SimpleMP3DescriberConfig->video_thumbnail = $config->video_thumbnail;
$SimpleMP3DescriberConfig->ffmpeg_pathname = $config->ffmpeg_pathname;
$SimpleMP3DescriberConfig->video_thumbnail_format = $config->video_thumbnail_format;
$SimpleMP3DescriberConfig->video_thumbnail_timestamp_offset = $config->video_thumbnail_timestamp_offset;
if(!$config->use_mp3_realtime_streaming) {
    $SimpleMP3DescriberConfig->is_hls_mode = false;
}
unset($config->mp3_realtime_encrypt);
unset($config->mp3_realtime_encryption_key_rotation_period);
if($called_position === 'before_module_init' && in_array($_SERVER['REQUEST_METHOD'], array('GET', 'POST'))){
    if(in_array($act, array('getSimpleMP3Descriptions', 'getFileCount', 'getFileDescription', 'updateSimpleMP3Thumbnail', 'getSimpleMP3EncryptionKey', 'getSimpleMP3M3U8', 'getSimpleMP3Lyric'))) {
        if(function_exists('header_remove')) {
            header_remove('Set-Cookie');
        }

        $result = new stdClass();
        if($act === 'getSimpleMP3Descriptions') {
            ini_set('max_execution_time', 15);
            $document_srl = Context::get('document_srl');
            $describer = new SimpleMP3Describer($SimpleMP3DescriberConfig);
            $descriptions = $describer->getDescriptionsByDocumentSrl($document_srl, $config->thumbnail_type, $config->thumbnail_width, $config->thumbnail_height, $config->mp3_realtime_segment_duration);
            unset($config->lyric_cache_expire);
            unset($config->lyric_cache_retry_duration);
            unset($config->ffmpeg_pathname);
            $result->descriptions = $descriptions;
            $result->config = $config;
        } else if($act === 'getSimpleMP3Lyric') {
            $type = Context::get('type');
            $file_srl = Context::get('file_srl');
            $lyric = $file_srl ? SimpleMP3Describer::getALSongLyric($file_srl, $config->lyric_cache_expire, $config->lyric_cache_retry_duration) : null;
            if($type === 'text') {
                if($lyric) {
                    echo $lyric;
                }
                exit();
            } else {
                $result->lyric = $lyric;
            }
        } else if($act === 'getFileCount') {
            $mid = Context::get('mid');
            $document_srl = Context::get('document_srl');
            $category_srl = Context::get('category_srl');
            $search_target = Context::get('search_target');
            $search_keyword = Context::get('search_keyword');
            $count = SimpleMP3Tools::getFileCount($mid, $document_srl, $category_srl, $search_target, $search_keyword);
            $result->prev = $count->prev;
            $result->next = $count->next;
            $result->random = $count->random;
        } else if($act === 'getFileDescription') {
            $mid = Context::get('mid');
            $document_srl = Context::get('document_srl');
            $category_srl = Context::get('category_srl');
            $search_target = Context::get('search_target');
            $search_keyword = Context::get('search_keyword');
            $offsets = Context::get('offset');
            $result->descriptions = array();
            $describer = new SimpleMP3Describer($SimpleMP3DescriberConfig);
            if($mid && $document_srl && is_array($offsets)) {
                foreach($offsets as $offset) {
                    $randomData = SimpleMP3Tools::getRandomFile($mid, $document_srl, $offset, $category_srl, $search_target, $search_keyword);
                    if($randomData && $randomData->data) {
                        $data = array_shift($randomData->data);
                        $description = $describer->getDescription($data->file_srl, $data->uploaded_filename, $data->source_filename, $data->document_srl, $data->sid, $data->module_srl, $config->mp3_realtime_segment_duration);
                        $describer->normalizeDescription($description, $data->document_srl, $data->file_srl);
                        if($description) {
                            $thumbnail = null;
                            $oDocumentModel = getModel('document');
                            $oDocument = $oDocumentModel->getDocument($data->document_srl);
                            if($config->thumbnail_type && $config->thumbnail_width > 0 && $config->thumbnail_height > 0) {
                                $documentThumbnail = $oDocument->getThumbnail($config->thumbnail_width, $config->thumbnail_height, $config->thumbnail_type);
                                if($oDocument->thumbnailExists($config->thumbnail_width, $config->thumbnail_height, $config->thumbnail_type) && $documentThumbnail) {
                                    $thumbnail = $documentThumbnail;
                                }
                            }
                            $description->offset = (int)$offset;
                            $description->document_srl = $data->document_srl;
                            $description->document_title = $data->title;
                            $description->thumbnail = $thumbnail;
                            $description->module_srl = $data->module_srl;
                            $description->editable = $oDocument->isGranted();
                            $result->descriptions[] = $description;
                        }
                    }
                }
            }
        } else if($act === 'updateSimpleMP3Thumbnail') {
            $document_srl = Context::get('document_srl');
            $file_srl = Context::get('file_srl');
            if($document_srl && $file_srl && SimpleMP3Tools::isNotXSSRequest()) {
                $output = SimpleMP3Tools::setDocumentThumbnail($document_srl, $file_srl, $config);
                $result->result = $output;
            }
        } else if($act === 'getSimpleMP3EncryptionKey') {
            if (checkCSRF() || !isset($_SERVER['HTTP_REFERER']) ) {
                exit();
            }

            $handshake = Context::get('handshake');
            $document_srl = Context::get('document_srl');
            $file_srl = Context::get('file_srl');
            $ip = Context::get('ip');
            $timestamp = Context::get('timestamp');

            $oFileModel = getModel('file');
            $oFile = $oFileModel->getFile($file_srl);
            if($password && $oFile && SimpleMP3Describer::isAccessibleDocument($oFile->upload_target_srl)) {
                $document_srl = (string)$oFile->upload_target_srl;
                echo SimpleEncrypt::getBufferEncryptionKey($password, $handshake, $timestamp, $oFile->upload_target_srl, $file_srl, $ip);
            }
            exit();
        } else if($act === 'getSimpleMP3M3U8') {
            if($config->allow_m3u8_cors) {
                header('Access-Control-Allow-Headers: Accept, Authorization, Content-Type, Origin');
                header('Access-Control-Allow-Methods: GET');
                header('Access-Control-Allow-Origin: *');
                header('Allow: GET');
            }
            $m3u8text = null;
            if($password && $config->use_hls_standard) {
                $file_srl = Context::get('file_srl');
                $oFileModel = getModel('file');
                $oFile = $oFileModel->getFile($file_srl);
                if($oFile) {
                    if(SimpleMP3Describer::isAccessibleDocument($oFile->upload_target_srl)) {
                        $document_srl = (string)$oFile->upload_target_srl;
                        $describer = new SimpleMP3Describer($SimpleMP3DescriberConfig);
                        $description = $describer->getDescription($oFile->file_srl, $oFile->uploaded_filename, $oFile->source_filename, $oFile->document_srl, $oFile->sid, $oFile->module_srl, $config->mp3_realtime_segment_duration);
                        $describer->normalizeDescription($description, $document_srl, $oFile->file_srl, true);
                        $m3u8text = SimpleMP3Describer::getM3U8Playlist($description);
                    } else {
                        header('HTTP/1.0 403 Forbidden');
                        exit("403 Forbidden");
                    }
                }
            }

            if($m3u8text) {
                if($config->m3u8_gzip_compress && function_exists("gzencode") && strpos( $_SERVER['HTTP_ACCEPT_ENCODING'], 'gzip' ) !== false) {
                    header('Content-Encoding: gzip');
                    $m3u8text = gzencode($m3u8text, 6);
                }
                header("Content-Type: audio/mpegurl");
                header("Content-Length: ".strlen($m3u8text));

                echo $m3u8text;
            } else {
                header('HTTP/1.0 404 Not Found');
                exit("Cannot read HLS playlist.");
            }

            exit();
        }
        $result->message = "success";
        echo json_encode($result);
        exit();
    }

} else if($act === 'procBoardInsertDocument' && $called_position === 'after_module_proc') {
    if($config->document_thumbnail) {
        $document_srl = Context::get('document_srl');
        if($document_srl) {
            SimpleMP3Tools::setDocumentThumbnail($document_srl, null, $config);
        }
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

} else if($called_position == 'after_module_proc' && Context::getResponseMethod()!="XMLRPC" && Context::get('document_srl')
    && !in_array($act, array('dispBoardWrite', 'dispBoardDelete', 'dispBoardWriteComment', 'dispBoardReplyComment', 'dispBoardModifyComment', 'dispBoardDeleteComment'))
) {
    Context::loadFile(array('./addons/simple_mp3_player/js/corejs.min.js', 'body', '', null), true);
    Context::loadFile(array('./addons/simple_mp3_player/js/transmuxer.js', 'body', '', null), true);
    Context::loadFile(array('./addons/simple_mp3_player/js/base.js', 'body', '', null), true);
    if(!isset($addon_info->mp3_realtime_encrypt) || $addon_info->mp3_realtime_encrypt) {
    }
    if(!isset($addon_info->playlist_player) || !$addon_info->playlist_player) {
        $addon_info->playlist_player = 'BluePlayer';
    }
    if($addon_info->playlist_player === 'APlayer') {
        Context::loadFile('./addons/simple_mp3_player/css/APlayer.min.css', true);
        Context::loadFile(array('./addons/simple_mp3_player/js/APlayer.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/aplayer_loader.js', 'body', '', null), true);
    } else if($addon_info->playlist_player === 'APlayer_fixed') {
        Context::loadFile('./addons/simple_mp3_player/css/APlayer.min.css', true);
        Context::loadFile(array('./addons/simple_mp3_player/js/APlayer.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/aplayer_fixed_loader.js', 'body', '', null), true);
    } else if($addon_info->playlist_player === 'BluePlayer') {
        Context::loadFile('./addons/simple_mp3_player/css/simplebar.css', true);
        Context::loadFile('./addons/simple_mp3_player/css/clusterize.css', true);
        Context::loadFile('./addons/simple_mp3_player/css/BluePlayer.css', true);
        Context::loadFile(array('./common/js/plugins/ui/jquery-ui.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/jquery.ui.touch-punch.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/clusterize.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/simplebar.min.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/BluePlayer.js', 'body', '', null), true);
        Context::loadFile(array('./addons/simple_mp3_player/js/blueplayer_loader.js', 'body', '', null), true);
    }
} else if($called_position == "before_display_content" && $act != 'dispPageAdminContentModify'&& Context::getResponseMethod() == 'HTML' && !isCrawler()
    && !in_array($act, array('dispBoardWrite', 'dispBoardDelete', 'dispBoardWriteComment', 'dispBoardReplyComment', 'dispBoardModifyComment', 'dispBoardDeleteComment'))
) {

    $script .= "\n\n<script>\n";
    $script .= "//<![CDATA[\n";
    $script .= '(function($SimpleMP3Player){
    $SimpleMP3Player.mode = '.($config->library_mode ? '"lib"' : '"default"').';
})(window.$SimpleMP3Player || (window.$SimpleMP3Player = {}))';
    $script .= "\n//]]>\n";
    $script .= "</script>\n";
    $output = $script.$output;


    $document_srl = Context::get('document_srl');
    if($document_srl) {
        $output = preg_replace_callback('/<!--BeforeDocument\(\d+,\d+\)-->(.*?)<!--AfterDocument\(\d+,\d+\)-->/is', function($callback){
            return preg_replace_callback('/<\s*(?:audio|video|source)\s*[^>]+(?:\/?>?)/is', function($callback) {
                return preg_replace_callback('/(?:((?:\w|-)+)(?:=\"([^\">]+)?\")?)/is', function($callback) {
                    $attr = strtolower($callback[1]);
                    switch($attr) {
                        case 'autoplay':
                            return 'data-'.$callback[1];
                        case 'src':
                            return 'data-'.$callback[0];
                        case 'loop':
                            return "";
                        default:
                            return $callback[0];
                    }
                }, $callback[0]);
            }, $callback[0]);
        }, $output);
    }
}

unset($SimpleMP3DescriberConfig);
unset($password);
unset($config);

