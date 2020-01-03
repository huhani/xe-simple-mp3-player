<?php

require_once './simple_encrypt.module.php';

function isEncrypted() {
    $Signature = isset($_GET['Signature']) ? $_GET['Signature'] : null;

    return !!$Signature;
}

function determineValidParameter($isKeyRequest = false) {
    $validParams = array('seq', 'id3', 'cors');
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

    foreach($validParams as $param) {
        if(!in_array($param, $arguments_split) && isset($_GET[$param])) {
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


function id3TimestampRepresentation($timestamp) {
    $chars = array();
    $mpeg2Timestamp = (int)floor($timestamp * 90000);
    $mpeg2Timestamp = str_pad(dechex($mpeg2Timestamp), 16, "0", STR_PAD_LEFT);
    for($i=0; $i<16; $i+=2) {
        $chars[] = hexdec(substr($mpeg2Timestamp, $i, 2));
    }

    return implode(array_map("chr", $chars));
}

function buildID3Header($timestampOffset) {
    $owner = "com.apple.streaming.transportStreamTimestamp";
    $buffer = array(
        "ID3",
        chr(0x04), chr(0),
        chr(0),
        chr(0), chr(0), chr(0), chr(63),
        "PRIV",
        chr(0), chr(0), chr(0), chr(53),
        chr(0), chr(0),
        $owner,
        chr(0),
        id3TimestampRepresentation($timestampOffset)
    );

    return implode($buffer);
}

function int2IV($num) {
    $iv = array(0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0);
    for($i=12; $i<16; $i++) {
        $iv[$i] = $num >> 8 * (15 - $i) & 255;
    }

    return implode(array_map("chr", $iv));
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
$seq = isset($_GET['seq']) ? (int)$_GET['seq'] : null;
$id3 = isset($_GET['id3']) ? (int)$_GET['id3'] : null;
$cors = isset($_GET['cors']) ? (int)$_GET['cors'] : null;

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

    if($cors > 1) {
        header('Access-Control-Allow-Headers: Accept, Authorization, Content-Type, Origin');
        header('Access-Control-Allow-Methods: GET');
        header('Access-Control-Allow-Origin: *');
        header('Allow: GET');
    }

    $size = $endOffset-$startOffset+1;
    fseek($file, $startOffset);
    $data = fread($file, $size);

    $offset = isset($_GET['offset']) ? (double)$_GET['offset'] : null;
    if($offset !== null && $seq !== null && $id3 !== 0) {
        $timestampOffset = $offset;
        $data = buildID3Header($timestampOffset).$data;
    }

    if($bufferEncryptionKey) {
        $iv = $seq !== null ? int2IV((int)$seq) : null;
        if($iv) {
            $encData = SimpleEncrypt::getEncryptDetail($data, $bufferEncryptionKey, $iv);
            $data = $encData->cipher;
        } else {
            $data = SimpleEncrypt::getEncrypt($data, $bufferEncryptionKey, false);
        }
    }

    $size = strlen($data);

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







