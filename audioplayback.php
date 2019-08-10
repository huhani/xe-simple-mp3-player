<?php

require_once './simple_encrypt.module.php';

function isEncrypted() {
    $Signature = isset($_GET['Signature']) ? $_GET['Signature'] : null;

    return !!$Signature;
}

function determineValidParameter() {
    $arguments = isset($_GET['arguments']) ? $_GET['arguments'] : null;
    $hash = isset($_GET['SN']) ? $_GET['SN'] : null;
    $text = '';
    if(!$arguments || !$hash) {
        return false;
    }
    $arguments_split = explode(',', $arguments);
    $foundFileParameter = in_array('file', $arguments_split);
    if(!isEncrypted() && isset($_GET['file']) && !$foundFileParameter) {
        return false;
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



// ============================= 요청 시작 부분

if(!determineValidParameter()) {
    header('HTTP/1.1 403 Forbidden');
    return;
}
$password = SimpleEncrypt::getPassword();
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

if($isSegment) {
    $size = $endOffset-$startOffset+1;
    fseek($file, $startOffset);
    $data = fread($file, $size);
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







