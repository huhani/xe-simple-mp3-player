<?php

require_once './simple_encrypt.module.php';

function isEncrypted() {
    $Signature = isset($_GET['Signature']) ? $_GET['Signature'] : null;

    return !!$Signature;
}

function determineValidParameter($isKeyRequest = false) {
    $arguments = isset($_GET['arguments']) ? $_GET['arguments'] : null;
    $hash = isset($_GET['SN']) ? $_GET['SN'] : null;
    $text = '';
    if(!$arguments || !$hash) {
        return false;
    }
    $arguments_split = explode(',', $arguments);
    if(!$isKeyRequest) {
        $foundFileParameter = in_array('file', $arguments_split);
        if(!isEncrypted() && isset($_GET['file']) && !$foundFileParameter) {
            return false;
        }
    }

    foreach($arguments_split as $eachArgument) {
        $argType = gettype($eachArgument);
        if(!isset($_GET[$eachArgument]) || !($argType === 'number' || $argType === 'string')) {
            return false;
        }

        $text .= (string)$_GET[$eachArgument];
    }

    return substr(md5($text . SimpleEncrypt::getPassword()), 0, 24) === (string)$hash;
}

function isKeyRequest() {
    return isset($_GET['Public']) && isset($_GET['handshake']);
}

function getDecryptKey($password) {
    $Public = isset($_GET['Public']) ? (string)$_GET['Public'] : null;
    $handshake = isset($_GET['handshake']) ? (string)$_GET['handshake'] : null;
    $timestamp = isset($_GET['timestamp']) && $_GET['timestamp'] ? (string)$_GET['timestamp'] : null;
    $document_srl = isset($_GET['document_srl']) && $_GET['document_srl'] ? (string)$_GET['document_srl'] : null;
    $file_srl = isset($_GET['file_srl']) && $_GET['file_srl'] ? (string)$_GET['file_srl'] : null;
    $ip = isset($_GET['ip']) && $_GET['ip'] ? (string)$_GET['ip'] : null;
    if($Public && $handshake) {
        $hash = SimpleEncrypt::getBufferPublicKey($password, $handshake);
        $decrypt = SimpleEncrypt::getDecrypt($Public, $password);
        if($decrypt && strlen($decrypt) === 20 && strcmp($decrypt, $hash) === 0) {
            addCacheControlHeader();
            return SimpleEncrypt::getBufferEncryptionKey($password, $handshake, $timestamp, $document_srl, $file_srl, $ip);
        }
    }

    return "";
}

function addCacheControlHeader() {
    $timestamp = isset($_GET['timestamp']) && (int)$_GET['timestamp'] > 0 ? (int)$_GET['timestamp'] : 0;
    if($timestamp) {
        $now = time();
        $diff = $now - $timestamp;
        $ageDuration = 21300;
        $age = $ageDuration + 5 - $diff;
        header('Cache-Control: private, max-age=' . (max(min($ageDuration, $age), 0)) );
    }
}

// ============================= 요청 시작 부분
if(!determineValidParameter(isKeyRequest())) {
    header('HTTP/1.1 403 Forbidden');
    return;
}
$password = SimpleEncrypt::getPassword();
if(isKeyRequest()) {
    echo getDecryptKey($password);
    exit();
}



$uploaded_filename = null;
if(isEncrypted()) {
    if(SimpleEncrypt::isEncryptSupported()) {
        $Signature = $_GET['Signature'];
        if($Signature && $password) {
            $data = SimpleEncrypt::getDecrypt($Signature, $password);
            if($data) {
                $uploaded_filename = $data;
            }
        }
    }
} else {
    $uploaded_filename = $file = $_GET['file'];
}
$mimeType = isset($_GET['mime']) && $_GET['mime'] !== 'unknown' ? $_GET['mime'] : null;
$startOffset = isset($_GET['start']) ? (int)$_GET['start'] : null;
$endOffset = isset($_GET['end']) ? (int)$_GET['end'] : null;
$isSegment = $_GET['type'] === 'realtime';
$isBufferEncrypt = isset($_GET['handshake']);
$handshake = $isBufferEncrypt ? (string)$_GET['handshake'] : null;
$timestamp = isset($_GET['timestamp']) && $_GET['timestamp'] ? (string)$_GET['timestamp'] : null;
$document_srl = isset($_GET['document_srl']) && $_GET['document_srl'] ? (string)$_GET['document_srl'] : null;
$file_srl = isset($_GET['file_srl']) && $_GET['file_srl'] ? (string)$_GET['file_srl'] : null;
$ip = isset($_GET['ip']) && $_GET['ip'] ? $_GET['ip'] : null;

$bufferEncryptionKey = $isBufferEncrypt ? SimpleEncrypt::getBufferEncryptionKey($password, $handshake, $timestamp, $document_srl, $file_srl, $ip) : null;


$uploaded_filename = '../../'.$uploaded_filename;
$filesize = null;
if($uploaded_filename && file_exists($uploaded_filename)) {
    $filesize = filesize($uploaded_filename);
    if($isSegment) {
        if($startOffset < 0 || $endOffset>$filesize || $startOffset>$endOffset) {
            header('HTTP/1.1 416 Requested Range Not Satisfiable');
            exit();
        }
    }
} else {
    header('HTTP/1.1 404 Not Found');
    exit();
}

$streamStartOffset = isset($_GET['streamStartOffset']) ? (int)$_GET['streamStartOffset'] : 0;
$streamEndOffset = isset($_GET['streamEndOffset']) ? (int)$_GET['streamEndOffset'] : $filesize-1;
$streamLength = $streamStartOffset !== null && $streamEndOffset !== null ? $streamEndOffset-$streamStartOffset+1 : $filesize;

$file = fopen($uploaded_filename, 'r');
header('Accept-Ranges: bytes');
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time()));
//$bufferEncryptionKey = false;
if($isSegment) {
    $size = $endOffset-$startOffset+1;
    fseek($file, $startOffset);
    $data = fread($file, $size);
    if($bufferEncryptionKey) {
        $data = SimpleEncrypt::getEncrypt($data, $bufferEncryptionKey, false);
        $size = strlen($data);
    }

    addCacheControlHeader();
    header('Content-Type: '.$mimeType);
    header('Content-Length: ' . $size);

    echo $data;
} else {
    header('Content-Type: '.$mimeType);
    header("Accept-Ranges: bytes");
    $httpRange = isset($_SERVER['HTTP_RANGE']) ? $_SERVER['HTTP_RANGE'] : null;
    $c_start = 0;
    $c_end   = $streamEndOffset-$streamStartOffset;
    $c_length = $c_end+1;
    $_start = $c_start;
    $_end = $c_end;
    if ($httpRange) {
        list(, $range) = explode('=', $httpRange, 2);
        if (strpos($range, ',') !== false) {
            header('HTTP/1.1 416 Requested Range Not Satisfiable');
            header("Content-Range: bytes $c_start-$c_end/".($c_length));
            exit;
        }
        if ($range == '-') {
            $_start = 0;
        }else{
            $range  = explode('-', $range);
            $_start = $range[0];
            $_end   = (isset($range[1]) && is_numeric($range[1])) ? $range[1] : $c_length-1;
        }
        $_end = ($_end > $c_end) ? $c_end : $_end;
        if ($_start > $_end || $_start > $c_length - 1 || $_end >= $c_length || $_start < $c_start || $_end > $c_end) {
            header('HTTP/1.1 416 Requested Range Not Satisfiable');
            header("Content-Range: bytes $c_start-$c_end/$c_length");
            exit;
        }

        header('HTTP/1.1 206 Partial Content');
    }

    $start  = $streamStartOffset + $_start;
    $end    = $streamStartOffset + $_end;
    $length = $_end - $_start + 1;
    fseek($file, $start);

    header("Content-Range: bytes $_start-$_end/$c_length");
    header("Content-Length: ".$length);

    $buffer = 1024 * 8;
    while(!feof($file) && ($p = ftell($file)) <= $end) {
        if ($p + $buffer > $end) {
            $buffer = $end - $p + 1;
        }
        set_time_limit(0);
        echo fread($file, $buffer);
        flush();
    }
}

fclose($file);







