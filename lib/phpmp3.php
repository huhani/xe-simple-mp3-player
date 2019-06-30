<?php
/**
 * Class PHPMP3
 *
 * @license LGPL
 */
class PHPMP3
{

    /**
     * The full mp3 file
     *
     * @var string
     */
    private $str;

    /**
     * The time length of the current file
     *
     * @var
     */
    private $time;

    /**
     * The amount of frames in the current file
     *
     * @var
     */
    private $frames = null;

    private $streamStartPos = null;
    private $streamEndPos = null;


    /**
     * Translate ascii characters to binary
     *
     * @var array
     */
    private $binaryTable;

    private $frameIndex = array();
    private $frameDurationAsIndexing = 5;


    private $frequency = null;
    private $mpegVersion = null;
    private $layerVersion = null;

    /**
     * Construct a new instance
     *
     * @param string $path Path to an mp3 file
     */
    public function __construct($path = '')
    {
        $this->binaryTable = array();
        for ($i = 0; $i < 256; $i ++) {
            $this->binaryTable[chr($i)] = sprintf('%08b', $i);
        }

        if ($path != '') {
            $this->str = file_get_contents($path);
        }
    }

    /**
     * Set the mp3 data
     *
     * @param string $str Mp3 file
     * @return void
     */
    public function setStr($str)
    {
        $this->str = $str;
    }

    /**
     * Get the start of audio data
     *
     * @return bool|int|void
     */
    public function getStart()
    {
        $skipID3V2Tag = $this->skipID3V2Tag($this->str);
        if($skipID3V2Tag !== 0) {
            $currentStrPos = $skipID3V2Tag-1;
        } else {
            $currentStrPos = - 1;
        }
        while (true) {
            $currentStrPos = strpos($this->str, chr(255), $currentStrPos + 1);
            if ($currentStrPos === false) {
                return 0;
            }
            $str    = substr($this->str, $currentStrPos, 4);
            $strlen = strlen($str);
            $parts  = array();
            for ($i = 0; $i < $strlen; $i ++) {
                $parts[] = $this->binaryTable[$str[$i]];
            }
            if ($this->doFrameStuff($parts) === false) {
                continue;
            }

            return $currentStrPos;
        }
    }
    
    public function getALSongLRCHash() {
        $strLen = strlen($this->str);
        $startPosition = $this->getStart();
        $hashCalcLen = $strLen-$startPosition+1;
        if($hashCalcLen > 163840) {
            $hashCalcLen = 163840;
        }
        return md5(substr($this->str, $startPosition, 163840));
    }
    
	private function skipID3v2Tag(&$block) {
		if (substr($block, 0,3)=="ID3") {
			$id3v2_flags = ord($block[5]);
			$flag_footer_present = $id3v2_flags & 0x10 ? 1 : 0;
			$z0 = ord($block[6]);
			$z1 = ord($block[7]);
			$z2 = ord($block[8]);
			$z3 = ord($block[9]);
			if ( (($z0&0x80)==0) && (($z1&0x80)==0) && (($z2&0x80)==0) && (($z3&0x80)==0) ) {
				$header_size = 10;
				$tag_size = (($z0&0x7f) * 2097152) + (($z1&0x7f) * 16384) + (($z2&0x7f) * 128) + ($z3&0x7f);
				$footer_size = $flag_footer_present ? 10 : 0;
				return $header_size + $tag_size + $footer_size;
			}
		}
		return 0;
	}
    

    /**
     * Manually count the frames and time of the file
     *
     * @return bool
     */
    public function setFileInfoExact($skipPaddingData = true)
    {
        $maxStrLen     = strlen($this->str);
        $currentStrPos = $this->getStart();

        $skipFrameKeywords = array('Xing', 'Info');
        $paddingData = $this->getPaddingData();
        $frequency = $this->getMP3Frequency();
        
        $sampleRatePerSec = 1/$frequency;
        $frontSkipTime = 0;
        $endSkipTime = 0;
        $hasFrontInfoRemoved = false;
        $frameDurationAsIndexing = $this->frameDurationAsIndexing;
        if($paddingData) {
            $frontSkipTime = $paddingData->frontPadding * $sampleRatePerSec;
            $endSkipTime = $paddingData->endPadding * $sampleRatePerSec;
        }
        
        $framesCount = 0;
        $time        = 0;
        
        $frameIndexTime = 0;
        $startCount     = - 1;
        $endCount       = - 1;
        
        while ($currentStrPos < $maxStrLen) {
            $str    = substr($this->str, $currentStrPos, 4);
            $strlen = strlen($str);
            $parts  = array();
            for ($i = 0; $i < $strlen; $i ++) {
                $parts[] = $this->binaryTable[$str[$i]];
            }
            if ($parts[0] != '11111111') {
                if (($maxStrLen - 128) > $currentStrPos) {
                    return false;
                } else {
                    $this->time   = $time;
                    $this->frames = $framesCount;
                    $this->setElimateEndPaddingFromEndOffset($frameCount, $time, $endSkipTime);
                    return true;
                }
            }
            $a = $this->doFrameStuff($parts);
            if($frontSkipTime > 0) {
                $frontSkipTime -= $a[1];
                $startCount = -1;
                continue;
            } else if($hasFrontInfoRemoved === false) {
                $thisStr = substr($this->str, $currentStrPos, 512);
                foreach($skipFrameKeywords as $key=>$value) {
                    if(strpos($thisStr, $value) !== false) {
                        $hasFrontInfoRemoved = true;
                        break;
                    }
                }
                if($hasFrontInfoRemoved === true) {
                    $frontSkipTime -= $a[1];
                    $currentStrPos += $a[0];
                    continue;
                }
                $hasFrontInfoRemoved = null;

            }
            
            if( ($hasFrontInfoRemoved === null || $hasFrontInfoRemoved === true) && count($this->frameIndex) === 0) {
                $initObjIndex = new stdClass;
                $initObjIndex->byteOffset = $currentStrPos;
                $initObjIndex->frameIndex = $framesCount;
                $initObjIndex->timestampOffset = 0;
                $this->frameIndex = array($initObjIndex);
                $this->streamStartPos = $currentStrPos;
            }
            $currentStrPos += $a[0];
            $time += $a[1];
            $framesCount ++;
            $this->streamEndPos = $currentStrPos;
            if($frameIndexTime >= $frameDurationAsIndexing) {
                $objFrameIndex = new stdClass;
                $objFrameIndex->byteOffset = $currentStrPos;
                $objFrameIndex->frameIndex = $framesCount;
                $objFrameIndex->timestampOffset = $time;
                $this->frameIndex[] = $objFrameIndex;
                $frameIndexTime = $a[1];
            } else {
                $frameIndexTime += $a[1];
            }
        }
        if($this->time === null && $time > 0) {
            $this->time   = $time;
            $this->frames = $framesCount;
        }
        $this->setElimateEndPaddingFromEndOffset($frameCount, $time, $endSkipTime);
        
        return true;
    }
    
    private function setElimateEndPaddingFromEndOffset($frame, $totalTime, $endSkipTime) {
        if($endSkipTime <= 0) {
            return;
        }
        $endPadding = $this->getEndOffsetFromEndPadding($frame, $totalTime, $endSkipTime);
        //print_r("\n###".$endSkipTime."/".$endPadding->timestampOffset);
        $this->time = $endPadding->timestampOffset;
        $this->frames = $endPadding->frameIndex;
        $this->streamEndPos = $endPadding->byteOffset;
    }
    
    private function getEndOffsetFromEndPadding($frame, $totalTime, $endSkipTime) {
        return $this->getOffsetFromPosition($totalTime-$endSkipTime);  
    }
    
    public function getDuration() {
        return $this->time;
    }
    
    public function getTotalFrame() {
        return $this->frames;
    }
    
    public function getFrameIndex() {
        return $this->frameIndex;
    }

    public function getStartByteOffset() {
        return $this->streamStartPos;
    }
    
    public function getEndByteOffset() {
        return $this->streamEndPos;
    }

    public function getStr() {
        return $this->str;
    }

    /**
     * Extract a portion of an mp3
     *
     * @param int $start Time in seconds to extract from
     * @param int $length Time in seconds to extract
     * @return static
     */
    public function extract($start, $length)
    {
        $maxStrLen     = strlen($this->str);
        $currentStrPos = $this->getStart();
        $framesCount   = 0;
        $time          = 0;
        $startCount    = - 1;
        $endCount      = - 1;
        while ($currentStrPos < $maxStrLen) {
            if ($startCount == - 1 && $time >= $start) {
                $startCount = $currentStrPos;
            }
            if ($endCount == - 1 && $time >= ($start + $length)) {
                $endCount = $currentStrPos - $startCount;
            }
            $str    = substr($this->str, $currentStrPos, 4);
            $strlen = strlen($str);
            $parts  = array();
            for ($i = 0; $i < $strlen; $i ++) {
                $parts[] = $this->binaryTable[$str[$i]];
            }
            if ($parts[0] == '11111111') {
                $a = $this->doFrameStuff($parts);
                $currentStrPos += $a[0];
                $time += $a[1];
                $framesCount ++;
            } else {
                break;
            }
        }
        
        return $this->extractFromByteOffset($startCount, $endCount);
        
        $mp3 = new static();
        if ($endCount == - 1) {
            $endCount = $maxStrLen - $startCount;
        }
        if ($startCount != - 1 && $endCount != - 1) {
            $mp3->setStr(substr($this->str, $startCount, $endCount));
        }
        return $mp3;
    }
    
    
    private function extractFromByteOffset($byteOffset, $byteLength) {
        $maxStrLen = $this->getEndByteOffset();
        if($byteOffset+$byteLength > $maxStrLen) {
            $byteLength = $maxStrLen-$byteOffset;
        }
        $mp3 = new static();
        $mp3->setStr(substr($this->str, $byteOffset, $byteLength));
        return $mp3;
    }
    
    public function split($splitPosition = 0) {
        $frameIndex = $this->frameIndex;
        if($this->getDuration() === null) {
            $this->setFileInfoExact();
        }
        $startByteOffset = $this->getStartByteOffset();
        $endByteOffset = $this->getEndByteOffset();
        $splitOffsetData = $this->getOffsetFromPosition($splitPosition);
        $splitByteOffset = $splitOffsetData->byteOffset;
        $mp3_1 = $this->extractFromByteOffset($startByteOffset, $splitByteOffset-$startByteOffset);
        $mp3_2 = $this->extractFromByteOffset($splitByteOffset, $endByteOffset-$splitByteOffset);
        
        return array($this->buildExtractObj($mp3_1, $startByteOffset, $splitByteOffset-$startByteOffset), $this->buildExtractObj($mp3_2, $splitByteOffset, $endByteOffset-$splitByteOffset));
    }
    
    
    private function buildExtractObj($mp3Obj, $startByteOffset, $length) {
        $obj = new stdClass;
        $obj->mp3 = $mp3Obj;
        $obj->startByteOffset = $startByteOffset;
        $obj->length = $length;
        
        return $obj;
    }
    
    public function getOffsetFromPosition($position = 0) {
        $frameIndex = $this->getFrameIndex();
        if($frameIndex === null) {
            $this->setFileInfoExact();
            $frameIndex = $this->getFrameIndex();
        }
        $currentStrPos = $this->getStartByteOffset();
        $framesCount = 0;
        $time = 0;
        $maxStrLen= $this->getEndByteOffset();
        $currentIndex = null;
        foreach($frameIndex as $key=>$value) {
            if($findPositionOffsetIndex === null) {
                $findPositionOffsetIndex = $value;
            }
            $thisTimestampOffset = $value->timestampOffset;
            $thisbyteOffset = $value->byteOffset;
            $thisFrameCount = $value->frameIndex;
            if($position<$thisTimestampOffset) {
                break;
            } else {
                $time = $thisTimestampOffset;
                $currentStrPos = $thisbyteOffset;
                $framesCount = $thisFrameCount;
            }
        }
        while ($currentStrPos < $maxStrLen) {
            $str    = substr($this->str, $currentStrPos, 4);
            $strlen = strlen($str);
            $parts  = array();
            for ($i = 0; $i < $strlen; $i ++) {
                $parts[] = $this->binaryTable[$str[$i]];
            }
            if ($parts[0] == '11111111') {
                $a = $this->doFrameStuff($parts);
                if($time+$a[1] > $position) {
                    break;
                }
                $currentStrPos += $a[0];
                $time += $a[1];
                $framesCount ++;
            } else {
                break;
            }
        }
        $offsetData = new stdClass();
        $offsetData->timestampOffset = $time;
        $offsetData->byteOffset = $currentStrPos;
        $offsetData->frameIndex = $framesCount;
        
        return $offsetData;
    }
    
    
    //!!!S
    public function getSplitPosition($partDuration = 10, $start = 0, $startOffset = null, $endOffset = null) {
        $aDurations = null;
        $durationsLength = 0;
        $durationPosition = 0;
        if(is_array($partDuration)) {
            $durationsLength = count($partDuration);
            if($durationsLength > 0) {
                if($durationsLength === 1) {
                    $partDuration = $partDuration[0];
                } else {
                    $aDurations = $partDuration;
                    $partDuration = $aDurations[0];
                }
            }
        }
        
        $arrPositions = array();
        $skipFrameKeywords = array('Xing', 'Info');
        
        $maxStrLen     = $endOffset ? $endOffset : strlen($this->str);
        $currentStrPos = $startOffset ? $startOffset : $this->getStart();
        $hasFrontInfoRemoved = false;
        if($startOffset !== null) {
            $paddingData = $this->getPaddingData();
            $frequency = $this->getMP3Frequency();
            $sampleRatePerSec = 1/$frequency;
        } else {
            $hasFrontInfoRemoved = null;
        }
        if($paddingData) {
            $frontSkipTime = $paddingData->frontPadding * $sampleRatePerSec;
            $endSkipTime = $paddingData->endPadding * $sampleRatePerSec;
        }
        
        $frontSkipTime = 0;
        $endSkipTime = 0;
        
        $prevPos = $currentStrPos;
        $framesCount   = 0;
        $totalTime     = 0;
        
        $prevTime      = 0;
        $prevFrameCount = 0;
        
        $time          = 0;
        $startCount    = - 1;
        $endCount      = - 1;
        
        while ($currentStrPos < $maxStrLen) {
            $str    = substr($this->str, $currentStrPos, 4);
            $strlen = strlen($str);
            $parts  = array();
            for ($i = 0; $i < $strlen; $i ++) {
                $parts[] = $this->binaryTable[$str[$i]];
            }
            
            $isBreak = false;
            if ($startCount == - 1) {
                $startCount = $currentStrPos;
            }
            if ($parts[0] == '11111111') {
                $a = $this->doFrameStuff($parts);
                if($frontSkipTime > 0) {
                    $frontSkipTime -= $a[1];
                    $startCount = -1;
                    continue;
                } else if($hasFrontInfoRemoved === false) {
                    $thisStr = substr($this->str, $currentStrPos, 512);
                    foreach($skipFrameKeywords as $key=>$value) {
                        if(strpos($thisStr, $value) !== false) {
                            $hasFrontInfoRemoved = true;
                            break;
                        }
                    }
                    if($hasFrontInfoRemoved === true) {
                        $frontSkipTime -= $a[1];
                        $startCount = -1;
                        $currentStrPos += $a[0];
                        continue;
                    }
                    $hasFrontInfoRemoved = null;
                }
                $currentStrPos += $a[0];
                $totalTime += $a[1];
                $time += $a[1];
                $framesCount ++;
            } else {
                $isBreak = true;
            }
            $isOverredStrPos = $currentStrPos >= $maxStrLen;
            if( ($endCount == - 1 && $time >= $partDuration) || $isOverredStrPos || $isBreak) {
                $isOverredDuration = $time >= $partDuration;
                $endCount = ($isOverredDuration || $isOverredStrPos ? $prevPos :  $currentStrPos) - $startCount;
                $oPosition = new stdClass;
                $oPosition->startOffset = $startCount;
                $oPosition->endOffset = $startCount+$endCount-1;
                $oPosition->time = $isOverredDuration ? $prevTime : $time;
                $arrPositions[] = $oPosition;
                if($isBreak) {
                    break;
                }
                if($isOverredDuration) {
                    $currentStrPos = $prevPos;
                }
                if($currentStrPos < $maxStrLen) {
                    $startCount = $oPosition->endOffset+1;
                    $framesCount = $prevFrameCount;
                    $endCount = -1;
                    $time = 0;
                    $prevTime = 0;
                } else {
                    break;
                }
                if($aDurations !== null) {
                    $partDuration = $aDurations[++$durationPosition];
                    if($durationPosition >= $durationsLength-1) {
                        $aDurations = null;
                    }
                }
            }
            $prevFrameCount = $framesCount;
            $prevPos = $currentStrPos;
            $prevTime = $time;
        }
        
        return $arrPositions;
    }
    
    public function getMP3Range($startOffset = 0, $endOffset = 0) {
        $mp3 = new static();
        $mp3->setStr(substr($this->str, $startOffset, $endOffset));
        return $mp3;
    }
    
    public function getMP3Frequency() {
        return $this->frequency;
    }
    
    public function getMP3LayerVersion() {
        return $this->layerVersion;
    }
    
    public function getMP3MPEGVersion() {
        return $this->mpegVersion;
    }
    
    private function readInt($buf) {
        $result = ord($buf[0]);
        for($i=1; $i<strlen($buf); ++$i) {
            $result <<= 8;
            $result += ord($buf[$i]);
        }
        return $result;
    }
    
    private function getPaddingData() {
        $currentStrPos = $this->getStart();
        $frontStr    = substr($this->str, $currentStrPos, 512);
        $headerData = substr($this->str, $currentStrPos, 4);
        $dataStrlen = strlen($headerData);
        $parts  = array();
        for ($i = 0; $i < $dataStrlen; $i ++) {
            $parts[] = $this->binaryTable[$headerData[$i]];
        }
        if ($parts[0] == '11111111') {
            $xingDataIndex = strpos($frontStr, "Xing");
            if($xingDataIndex === false) {
                $xingDataIndex = strpos($frontStr, "Info");
            }
            if($xingDataIndex !== false) {
                $xingFrameCountIndex = $xingDataIndex + 8;
                $xingDataIndex = strpos($frontStr, "LAME");
                if($xingDataIndex === false) {
                    $xingDataIndex = strpos($frontStr, "Lavf");
                }
                if($xingDataIndex !== false) {
                    $gaplessDataIndex = $xingDataIndex + 21;
                    $gaplessBits = $this->readInt(substr($frontStr, $gaplessDataIndex, 3));
                    $frontPadding = $gaplessBits >> 12;
                    $endPadding = $gaplessBits & 0xFFF;
                    $oPaddingData = new stdClass;
                    $oPaddingData->frontPadding = $frontPadding;
                    $oPaddingData->endPadding = $endPadding;
                    return $oPaddingData;
                }
                
            }
        }
        
        return false;
    }
    
    //!!!E

    /**
     * Get the length of a frame in bytes and seconds
     *
     * @param string[] $parts A frame with bytes converted to binary
     * @return array|bool
     */
    private function doFrameStuff($parts)
    {
        //Get Audio Version
        $seconds = 0;
        $errors  = array();
        switch (substr($parts[1], 3, 2)) {
            case '01':
                $errors[] = 'Reserved audio version';
                break;
            case '00':
                $audio = 25;
                break;
            case '10':
                $audio = 2;
                break;
            case '11':
                $audio = 1;
                break;
        }
        //Get Layer
        switch (substr($parts[1], 5, 2)) {
            case '01':
                $layer = 3;
                break;
            case '00':
                $errors[] = 'Reserved layer';
                break;
            case '10':
                $layer = 2;
                break;
            case '11':
                $layer = 1;
                break;
        }
        //Get Bitrate
        $bitFlag  = substr($parts[2], 0, 4);
        $bitArray = array(
            '0000' => array(0, 0, 0, 0, 0),
            '0001' => array(32, 32, 32, 32, 8),
            '0010' => array(64, 48, 40, 48, 16),
            '0011' => array(96, 56, 48, 56, 24),
            '0100' => array(128, 64, 56, 64, 32),
            '0101' => array(160, 80, 64, 80, 40),
            '0110' => array(192, 96, 80, 96, 48),
            '0111' => array(224, 112, 96, 112, 56),
            '1000' => array(256, 128, 112, 128, 64),
            '1001' => array(288, 160, 128, 144, 80),
            '1010' => array(320, 192, 160, 160, 96),
            '1011' => array(352, 224, 192, 176, 112),
            '1100' => array(384, 256, 224, 192, 128),
            '1101' => array(416, 320, 256, 224, 144),
            '1110' => array(448, 384, 320, 256, 160),
            '1111' => array(- 1, - 1, - 1, - 1, - 1)
        );
        $bitPart  = $bitArray[$bitFlag];
        $bitArrayNumber = null;
        if ($audio == 1) {
            switch ($layer) {
                case 1:
                    $bitArrayNumber = 0;
                    break;
                case 2:
                    $bitArrayNumber = 1;
                    break;
                case 3:
                    $bitArrayNumber = 2;
                    break;
            }
        } else {
            switch ($layer) {
                case 1:
                    $bitArrayNumber = 3;
                    break;
                case 2:
                    $bitArrayNumber = 4;
                    break;
                case 3:
                    $bitArrayNumber = 4;
                    break;
            }
        }
        $bitRate = $bitPart[$bitArrayNumber];
        if ($bitRate <= 0) {
            return false;
        }
        //Get Frequency
        $frequencies = array(
            1   => array(
                '00' => 44100,
                '01' => 48000,
                '10' => 32000,
                '11' => 'reserved'
            ),
            2   => array(
                '00' => 22050,
                '01' => 24000,
                '10' => 16000,
                '11' => 'reserved'
            ),
            25 => array(
                '00' => 11025,
                '01' => 12000,
                '10' => 8000,
                '11' => 'reserved'
            )
        );
        $timescale = $frequencies[1][substr($parts[2], 4, 2)];
        $freq        = $frequencies[$audio][substr($parts[2], 4, 2)];
        $frameLength = 0;
        //IsPadded?
        $padding = substr($parts[2], 6, 1);
        if ($layer == 3 || $layer == 2) {
            $frameLength = 144 * $bitRate * 1000 / $timescale + $padding;
        }
        //!!!S
        if($freq !== 'reserved') {
            if($this->frequency === null) {
                $this->frequency = $freq;
            } else if(is_array($this->frequency) && !in_array($freq, $this->frequency)) {
                $this->frequency[] = $freq;
            } else if($this->frequency !== $freq) {
                $this->frequency = array($this->frequency, $freq);
            }
            if($this->mpegVersion === null) {
                $this->mpegVersion = $audio;
                $this->layerVersion = $layer;
            }
        }

        //!!!E
        
        
        $frameLength = (int)$frameLength;
        if ($frameLength == 0) {
            return false;
        }
        $seconds += ($frameLength << 3) / ($bitRate * 1000);
        return array($frameLength, $seconds);
    }

    /**
     * Set ID3 data
     *
     * @param string $track
     * @param string $title
     * @param string $artist
     * @param string $album
     * @param string $year
     * @param string $genre
     * @param string $comments
     * @param string $composer
     * @param string $origArtist
     * @param string $copyright
     * @param string $url
     * @param string $encodedBy
     * @return void
     */
    public function setIdv3_2(
        $track,
        $title,
        $artist,
        $album,
        $year,
        $genre,
        $comments,
        $composer,
        $origArtist,
        $copyright,
        $url,
        $encodedBy
    ) {
        $urlLength        = (int) (strlen($url) + 2);
        $copyrightLength  = (int) (strlen($copyright) + 1);
        $origArtistLength = (int) (strlen($origArtist) + 1);
        $composerLength   = (int) (strlen($composer) + 1);
        $commentsLength   = (int) (strlen($comments) + 5);
        $titleLength      = (int) (strlen($title) + 1);
        $artistLength     = (int) (strlen($artist) + 1);
        $albumLength      = (int) (strlen($album) + 1);
        $genreLength      = (int) (strlen($genre) + 1);
        $encodedByLength  = (int) (strlen($encodedBy) + 1);
        $trackLength      = (int) (strlen($track) + 1);
        $yearLength       = (int) (strlen($year) + 1);

        $str = "ID3\x03\0\0\0\0\x085TRCK\0\0\0{$trackLength}\0\0\0{$track}TENC\0\0\0{$encodedByLength}@\0\0{$encodedBy}WXXX\0\0\0{$urlLength}\0\0\0\0{$url}TCOP\0\0\0{$copyrightLength}\0\0\0{$copyright}TOPE\0\0\0{$origArtistLength}\0\0\0{$origArtist}TCOM\0\0\0{$composerLength}\0\0\0{$composer}COMM\0\0\0{$commentsLength}\0\0\0\0\x09\0\0{$comments}TCON\0\0\0{$genreLength}\0\0\0{$genre}TYER\0\0\0{$yearLength}\0\0\0{$year}TALB\0\0\0{$albumLength}\0\0\0{$album}TPE1\0\0\0{$artistLength}\0\0\0{$artist}TIT2\0\0\0{$titleLength}\0\0\0{$title}";
        $this->str = $str . $this->str;
    }

    /**
     * Append another mp3 file to the end of this file
     *
     * @param self $mp3
     * @return void
     */
    public function mergeBehind(self $mp3)
    {
        $this->str .= $mp3->str;
    }

    /**
     * Prepend another mp3 to the start of this file
     *
     * @param self $mp3
     * @return void
     */
    public function mergeInfront(self $mp3)
    {
        $this->str = $mp3->str . $this->str;
    }

    /**
     * Get the end string of the ID3 data
     *
     * @return bool|string
     */
    private function getIdvEnd()
    {
        $strlen = strlen($this->str);
        $str    = substr($this->str, ($strlen - 128));
        $str1   = substr($str, 0, 3);
        if (strtolower($str1) == strtolower('TAG')) {
            return $str;
        } else {
            return false;
        }
    }

    /**
     * Remove ID3 data from the file
     *
     * @return bool
     */
    public function striptags()
    {
        //Remove start stuff...
        $s = $start = $this->getStart();
        if ($s === false) {
            return false;
        } else {
            $this->str = substr($this->str, $start);
        }
        //Remove end tag stuff
        $end = $this->getIdvEnd();
        if ($end !== false) {
            $this->str = substr($this->str, 0, (strlen($this->str) - 129));
        }
    }

    /**
     * Write an mp3 file
     *
     * @param string $path Path to write file to
     * @return bool
     */
    public function save($path)
    {
        $fp           = fopen($path, 'w');
        $bytesWritten = fwrite($fp, $this->str);
        fclose($fp);
        return $bytesWritten == strlen($this->str);
    }

    /**
     * Join multiple mp3 files into one file
     *
     * @param string $newpath
     * @param array $array
     * @return void
     */
    public function multiJoin($newpath, $array)
    {
        foreach ($array as $path) {
            $mp3 = new static($path);
            $mp3->striptags();
            $mp3_1 = new static($newpath);
            $mp3->mergeBehind($mp3_1);
            $mp3->save($newpath);
        }
    }
}
