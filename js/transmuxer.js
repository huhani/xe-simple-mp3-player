(function(global){
    var BitratesMap = [
        32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
        32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
        32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
        32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
        8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    var SamplingRateMap = [44100, 48000, 32000, 22050, 24000, 16000, 11025, 12000, 8000];
    var MP3Parser = (function () {
        function MP3Parser() {
            this.buffer = null;
            this.bufferSize = 0;
        }
        MP3Parser.prototype.push = function (data) {
            var length;
            if (this.bufferSize > 0) {
                var needBuffer = data.length + this.bufferSize;
                if (!this.buffer || this.buffer.length < needBuffer) {
                    var newBuffer = new Uint8Array(needBuffer);
                    if (this.bufferSize > 0) {
                        newBuffer.set(this.buffer.subarray(0, this.bufferSize));
                    }
                    this.buffer = newBuffer;
                }
                this.buffer.set(data, this.bufferSize);
                this.bufferSize = needBuffer;
                data = this.buffer;
                length = needBuffer;
            }
            else {
                length = data.length;
            }
    
            //console.log('push ' + length);
    
            var offset = 0;
            var parsed;
            while (offset < length &&
                (parsed = this._parse(data, offset, length)) > 0) {
                offset += parsed;
            }
            var tail = length - offset;
            if (tail > 0) {
                if (!this.buffer || this.buffer.length < tail) {
                    this.buffer = new Uint8Array(data.subarray(offset, length));
                }
                else {
                    this.buffer.set(data.subarray(offset, length));
                }
            }
            this.bufferSize = tail;
        };
        MP3Parser.prototype._parse = function (data, start, end) {
                //console.log('_parse');
                if (start + 2 > end) {
                return -1; // we need at least 2 bytes to detect sync pattern
            }
            if (data[start] === 0xFF || (data[start + 1] & 0xE0) === 0xE0) {
                // Using http://www.datavoyage.com/mpgscript/mpeghdr.htm as a reference
                if (start + 24 > end) {
                    return -1;
                }
                var headerB = (data[start + 1] >> 3) & 3;
                var headerC = (data[start + 1] >> 1) & 3;
                var headerE = (data[start + 2] >> 4) & 15;
                var headerF = (data[start + 2] >> 2) & 3;
                var headerG = !!(data[start + 2] & 2);
                if (headerB !== 1 && headerE !== 0 && headerE !== 15 && headerF !== 3) {
                    var columnInBitrates = headerB === 3 ? (3 - headerC) : (headerC === 3 ? 3 : 4);
                    var bitRate = BitratesMap[columnInBitrates * 14 + headerE - 1] * 1000;
                    var columnInSampleRates = headerB === 3 ? 0 : headerB === 2 ? 1 : 2;
                    var sampleRate = SamplingRateMap[columnInSampleRates * 3 + headerF];
                    var padding = headerG ? 1 : 0;
                    var frameLength = headerC === 3 ?
                        ((headerB === 3 ? 12 : 6) * bitRate / sampleRate + padding) << 2 :
                        ((headerB === 3 ? 144 : 72) * bitRate / sampleRate + padding) | 0;
                    if (start + frameLength > end) {
                        return -1;
                    }
                    if (this.onFrame) {
                        //console.log('onFrame');
                        if(!this.samplerate) {
                            this.samplerate = sampleRate;
                        }
                        this.onFrame(data.subarray(start, start + frameLength));
                    }
                    return frameLength;
                }
            }
            // noise or ID3, trying to skip
            var offset = start + 2;
            while (offset < end) {
                if (data[offset - 1] === 0xFF && (data[offset] & 0xE0) === 0xE0) {
                    // sync pattern is found
                    if (this.onNoise) {
                        this.onNoise(data.subarray(start, offset - 1));
                    }
                    return offset - start - 1;
                }
                offset++;
            }
            return -1;
        };
        
        MP3Parser.prototype.close = function () {
            if (this.bufferSize > 0) {
                if (this.onNoise) {
                    this.onNoise(this.buffer.subarray(0, this.bufferSize));
                }
            }
            this.buffer = null;
            this.bufferSize = 0;
            if (this.onClose) {
                this.onClose();
            }
        };
        
        return MP3Parser;
    })();


    var Iso = (function() {
        var __extends = (this && this.__extends) || function (d, b) {
            for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
        
        var Iso = {};
        
        var START_DATE = -2082844800000; /* midnight after Jan. 1, 1904 */
        var DEFAULT_MOVIE_MATRIX = [1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0];
        var DEFAULT_OP_COLOR = [0, 0, 0];
        
        function utf8decode(str) {
            var bytes = new Uint8Array(str.length * 4);
            var b = 0;
            for (var i = 0, j = str.length; i < j; i++) {
                var code = str.charCodeAt(i);
                if (code <= 0x7f) {
                    bytes[b++] = code;
                    continue;
                }
                if (0xD800 <= code && code <= 0xDBFF) {
                    var codeLow = str.charCodeAt(i + 1);
                    if (0xDC00 <= codeLow && codeLow <= 0xDFFF) {
                        // convert only when both high and low surrogates are present
                        code = ((code & 0x3FF) << 10) + (codeLow & 0x3FF) + 0x10000;
                        ++i;
                    }
                }
                if ((code & 0xFFE00000) !== 0) {
                    bytes[b++] = 0xF8 | ((code >>> 24) & 0x03);
                    bytes[b++] = 0x80 | ((code >>> 18) & 0x3F);
                    bytes[b++] = 0x80 | ((code >>> 12) & 0x3F);
                    bytes[b++] = 0x80 | ((code >>> 6) & 0x3F);
                    bytes[b++] = 0x80 | (code & 0x3F);
                }
                else if ((code & 0xFFFF0000) !== 0) {
                    bytes[b++] = 0xF0 | ((code >>> 18) & 0x07);
                    bytes[b++] = 0x80 | ((code >>> 12) & 0x3F);
                    bytes[b++] = 0x80 | ((code >>> 6) & 0x3F);
                    bytes[b++] = 0x80 | (code & 0x3F);
                }
                else if ((code & 0xFFFFF800) !== 0) {
                    bytes[b++] = 0xE0 | ((code >>> 12) & 0x0F);
                    bytes[b++] = 0x80 | ((code >>> 6) & 0x3F);
                    bytes[b++] = 0x80 | (code & 0x3F);
                }
                else {
                    bytes[b++] = 0xC0 | ((code >>> 6) & 0x1F);
                    bytes[b++] = 0x80 | (code & 0x3F);
                }
            }
            return bytes.subarray(0, b);
        }
        function concatArrays(arg0) {
            var args = [];
            for (var _i = 1; _i < arguments.length; _i++) {
                args[_i - 1] = arguments[_i];
            }
            return Array.prototype.concat.apply(arg0, args);
        }
        function writeInt32(data, offset, value) {
            data[offset] = (value >> 24) & 255;
            data[offset + 1] = (value >> 16) & 255;
            data[offset + 2] = (value >> 8) & 255;
            data[offset + 3] = value & 255;
        }
        function decodeInt32(s) {
            return (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) |
                (s.charCodeAt(2) << 8) | s.charCodeAt(3);
        }
        function encodeDate(d) {
            return ((d - START_DATE) / 1000) | 0;
        }
        function encodeFloat_16_16(f) {
            return (f * 0x10000) | 0;
        }
        function encodeFloat_2_30(f) {
            return (f * 0x40000000) | 0;
        }
        function encodeFloat_8_8(f) {
            return (f * 0x100) | 0;
        }
        function encodeLang(s) {
            return ((s.charCodeAt(0) & 0x1F) << 10) | ((s.charCodeAt(1) & 0x1F) << 5) | (s.charCodeAt(2) & 0x1F);
        }
        var Box = (function () {
            function Box(boxtype, extendedType) {
                this.boxtype = boxtype;
                if (boxtype === 'uuid') {
                    this.userType = extendedType;
                }
            }
            /**
             * @param offset Position where writing will start in the output array
             * @returns {number} Size of the written data
             */
            Box.prototype.layout = function (offset) {
                this.offset = offset;
                var size = 8;
                if (this.userType) {
                    size += 16;
                }
                this.size = size;
                return size;
            };
            /**
             * @param data Output array
             * @returns {number} Amount of written bytes by this Box and its children only.
             */
            Box.prototype.write = function (data) {
                writeInt32(data, this.offset, this.size);
                writeInt32(data, this.offset + 4, decodeInt32(this.boxtype));
                if (!this.userType) {
                    return 8;
                }
                data.set(this.userType, this.offset + 8);
                return 24;
            };
            Box.prototype.toUint8Array = function () {
                var size = this.layout(0);
                var data = new Uint8Array(size);
                this.write(data);
                return data;
            };
            return Box;
        })();
        Iso.Box = Box;
        var FullBox = (function (_super) {
            __extends(FullBox, _super);
            function FullBox(boxtype, version, flags) {
                if (version === void 0) { version = 0; }
                if (flags === void 0) { flags = 0; }
                _super.call(this, boxtype);
                this.version = version;
                this.flags = flags;
            }
            FullBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 4;
                return this.size;
            };
            FullBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, (this.version << 24) | this.flags);
                return offset + 4;
            };
            return FullBox;
        })(Box);
        Iso.FullBox = FullBox;
        var FileTypeBox = (function (_super) {
            __extends(FileTypeBox, _super);
            function FileTypeBox(majorBrand, minorVersion, compatibleBrands) {
                _super.call(this, 'ftype');
                this.majorBrand = majorBrand;
                this.minorVersion = minorVersion;
                this.compatibleBrands = compatibleBrands;
            }
            FileTypeBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 4 * (2 + this.compatibleBrands.length);
                return this.size;
            };
            FileTypeBox.prototype.write = function (data) {
                var _this = this;
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, decodeInt32(this.majorBrand));
                writeInt32(data, this.offset + offset + 4, this.minorVersion);
                offset += 8;
                this.compatibleBrands.forEach(function (brand) {
                    writeInt32(data, _this.offset + offset, decodeInt32(brand));
                    offset += 4;
                }, this);
                return offset;
            };
            return FileTypeBox;
        })(Box);
        Iso.FileTypeBox = FileTypeBox;
        var BoxContainerBox = (function (_super) {
            __extends(BoxContainerBox, _super);
            function BoxContainerBox(type, children) {
                _super.call(this, type);
                this.children = children;
            }
            BoxContainerBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset);
                this.children.forEach(function (child) {
                    if (!child) {
                        return; // skipping undefined
                    }
                    size += child.layout(offset + size);
                });
                return (this.size = size);
            };
            BoxContainerBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                this.children.forEach(function (child) {
                    if (!child) {
                        return; // skipping undefined
                    }
                    offset += child.write(data);
                });
                return offset;
            };
            return BoxContainerBox;
        })(Box);
        Iso.BoxContainerBox = BoxContainerBox;
        var MovieBox = (function (_super) {
            __extends(MovieBox, _super);
            function MovieBox(header, tracks, extendsBox, userData) {
                _super.call(this, 'moov', concatArrays([header], tracks, [extendsBox, userData]));
                this.header = header;
                this.tracks = tracks;
                this.extendsBox = extendsBox;
                this.userData = userData;
            }
            return MovieBox;
        })(BoxContainerBox);
        Iso.MovieBox = MovieBox;
        var MovieHeaderBox = (function (_super) {
            __extends(MovieHeaderBox, _super);
            function MovieHeaderBox(timescale, duration, nextTrackId, rate, volume, matrix, creationTime, modificationTime) {
                if (rate === void 0) { rate = 1.0; }
                if (volume === void 0) { volume = 1.0; }
                if (matrix === void 0) { matrix = DEFAULT_MOVIE_MATRIX; }
                if (creationTime === void 0) { creationTime = START_DATE; }
                if (modificationTime === void 0) { modificationTime = START_DATE; }
                _super.call(this, 'mvhd', 0, 0);
                this.timescale = timescale;
                this.duration = duration;
                this.nextTrackId = nextTrackId;
                this.rate = rate;
                this.volume = volume;
                this.matrix = matrix;
                this.creationTime = creationTime;
                this.modificationTime = modificationTime;
            }
            MovieHeaderBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 16 + 4 + 2 + 2 + 8 + 36 + 24 + 4;
                return this.size;
            };
            MovieHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                // Only version 0
                writeInt32(data, this.offset + offset, encodeDate(this.creationTime));
                writeInt32(data, this.offset + offset + 4, encodeDate(this.modificationTime));
                writeInt32(data, this.offset + offset + 8, this.timescale);
                writeInt32(data, this.offset + offset + 12, this.duration);
                offset += 16;
                writeInt32(data, this.offset + offset, encodeFloat_16_16(this.rate));
                writeInt32(data, this.offset + offset + 4, encodeFloat_8_8(this.volume) << 16);
                writeInt32(data, this.offset + offset + 8, 0);
                writeInt32(data, this.offset + offset + 12, 0);
                offset += 16;
                writeInt32(data, this.offset + offset, encodeFloat_16_16(this.matrix[0]));
                writeInt32(data, this.offset + offset + 4, encodeFloat_16_16(this.matrix[1]));
                writeInt32(data, this.offset + offset + 8, encodeFloat_16_16(this.matrix[2]));
                writeInt32(data, this.offset + offset + 12, encodeFloat_16_16(this.matrix[3]));
                writeInt32(data, this.offset + offset + 16, encodeFloat_16_16(this.matrix[4]));
                writeInt32(data, this.offset + offset + 20, encodeFloat_16_16(this.matrix[5]));
                writeInt32(data, this.offset + offset + 24, encodeFloat_2_30(this.matrix[6]));
                writeInt32(data, this.offset + offset + 28, encodeFloat_2_30(this.matrix[7]));
                writeInt32(data, this.offset + offset + 32, encodeFloat_2_30(this.matrix[8]));
                offset += 36;
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, 0);
                writeInt32(data, this.offset + offset + 8, 0);
                writeInt32(data, this.offset + offset + 12, 0);
                writeInt32(data, this.offset + offset + 16, 0);
                writeInt32(data, this.offset + offset + 20, 0);
                offset += 24;
                writeInt32(data, this.offset + offset, this.nextTrackId);
                offset += 4;
                return offset;
            };
            return MovieHeaderBox;
        })(FullBox);
        Iso.MovieHeaderBox = MovieHeaderBox;
        (function (TrackHeaderFlags) {
            TrackHeaderFlags[TrackHeaderFlags["TRACK_ENABLED"] = 1] = "TRACK_ENABLED";
            TrackHeaderFlags[TrackHeaderFlags["TRACK_IN_MOVIE"] = 2] = "TRACK_IN_MOVIE";
            TrackHeaderFlags[TrackHeaderFlags["TRACK_IN_PREVIEW"] = 4] = "TRACK_IN_PREVIEW";
        })(Iso.TrackHeaderFlags || (Iso.TrackHeaderFlags = {}));
        var TrackHeaderFlags = Iso.TrackHeaderFlags;
        var TrackHeaderBox = (function (_super) {
            __extends(TrackHeaderBox, _super);
            function TrackHeaderBox(flags, trackId, duration, width, height, volume, alternateGroup, layer, matrix, creationTime, modificationTime) {
                if (alternateGroup === void 0) { alternateGroup = 0; }
                if (layer === void 0) { layer = 0; }
                if (matrix === void 0) { matrix = DEFAULT_MOVIE_MATRIX; }
                if (creationTime === void 0) { creationTime = START_DATE; }
                if (modificationTime === void 0) { modificationTime = START_DATE; }
                _super.call(this, 'tkhd', 0, flags);
                this.trackId = trackId;
                this.duration = duration;
                this.width = width;
                this.height = height;
                this.volume = volume;
                this.alternateGroup = alternateGroup;
                this.layer = layer;
                this.matrix = matrix;
                this.creationTime = creationTime;
                this.modificationTime = modificationTime;
            }
            TrackHeaderBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 20 + 8 + 6 + 2 + 36 + 8;
                return this.size;
            };
            TrackHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                // Only version 0
                writeInt32(data, this.offset + offset, encodeDate(this.creationTime));
                writeInt32(data, this.offset + offset + 4, encodeDate(this.modificationTime));
                writeInt32(data, this.offset + offset + 8, this.trackId);
                writeInt32(data, this.offset + offset + 12, 0);
                writeInt32(data, this.offset + offset + 16, this.duration);
                offset += 20;
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, 0);
                writeInt32(data, this.offset + offset + 8, (this.layer << 16) | this.alternateGroup);
                writeInt32(data, this.offset + offset + 12, encodeFloat_8_8(this.volume) << 16);
                offset += 16;
                writeInt32(data, this.offset + offset, encodeFloat_16_16(this.matrix[0]));
                writeInt32(data, this.offset + offset + 4, encodeFloat_16_16(this.matrix[1]));
                writeInt32(data, this.offset + offset + 8, encodeFloat_16_16(this.matrix[2]));
                writeInt32(data, this.offset + offset + 12, encodeFloat_16_16(this.matrix[3]));
                writeInt32(data, this.offset + offset + 16, encodeFloat_16_16(this.matrix[4]));
                writeInt32(data, this.offset + offset + 20, encodeFloat_16_16(this.matrix[5]));
                writeInt32(data, this.offset + offset + 24, encodeFloat_2_30(this.matrix[6]));
                writeInt32(data, this.offset + offset + 28, encodeFloat_2_30(this.matrix[7]));
                writeInt32(data, this.offset + offset + 32, encodeFloat_2_30(this.matrix[8]));
                offset += 36;
                writeInt32(data, this.offset + offset, encodeFloat_16_16(this.width));
                writeInt32(data, this.offset + offset + 4, encodeFloat_16_16(this.height));
                offset += 8;
                return offset;
            };
            return TrackHeaderBox;
        })(FullBox);
        Iso.TrackHeaderBox = TrackHeaderBox;
        var MediaHeaderBox = (function (_super) {
            __extends(MediaHeaderBox, _super);
            function MediaHeaderBox(timescale, duration, language, creationTime, modificationTime) {
                if (language === void 0) { language = 'unk'; }
                if (creationTime === void 0) { creationTime = START_DATE; }
                if (modificationTime === void 0) { modificationTime = START_DATE; }
                _super.call(this, 'mdhd', 0, 0);
                this.timescale = timescale;
                this.duration = duration;
                this.language = language;
                this.creationTime = creationTime;
                this.modificationTime = modificationTime;
            }
            MediaHeaderBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 16 + 4;
                return this.size;
            };
            MediaHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                // Only version 0
                writeInt32(data, this.offset + offset, encodeDate(this.creationTime));
                writeInt32(data, this.offset + offset + 4, encodeDate(this.modificationTime));
                writeInt32(data, this.offset + offset + 8, this.timescale);
                writeInt32(data, this.offset + offset + 12, this.duration);
                writeInt32(data, this.offset + offset + 16, encodeLang(this.language) << 16);
                return offset + 20;
            };
            return MediaHeaderBox;
        })(FullBox);
        Iso.MediaHeaderBox = MediaHeaderBox;
        var HandlerBox = (function (_super) {
            __extends(HandlerBox, _super);
            function HandlerBox(handlerType, name) {
                _super.call(this, 'hdlr', 0, 0);
                this.handlerType = handlerType;
                this.name = name;
                this._encodedName = utf8decode(this.name);
            }
            HandlerBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 8 + 12 + (this._encodedName.length + 1);
                return this.size;
            };
            HandlerBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, decodeInt32(this.handlerType));
                writeInt32(data, this.offset + offset + 8, 0);
                writeInt32(data, this.offset + offset + 12, 0);
                writeInt32(data, this.offset + offset + 16, 0);
                offset += 20;
                data.set(this._encodedName, this.offset + offset);
                data[this.offset + offset + this._encodedName.length] = 0;
                offset += this._encodedName.length + 1;
                return offset;
            };
            return HandlerBox;
        })(FullBox);
        Iso.HandlerBox = HandlerBox;
        var SoundMediaHeaderBox = (function (_super) {
            __extends(SoundMediaHeaderBox, _super);
            function SoundMediaHeaderBox(balance) {
                if (balance === void 0) { balance = 0.0; }
                _super.call(this, 'smhd', 0, 0);
                this.balance = balance;
            }
            SoundMediaHeaderBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 4;
                return this.size;
            };
            SoundMediaHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, encodeFloat_8_8(this.balance) << 16);
                return offset + 4;
            };
            return SoundMediaHeaderBox;
        })(FullBox);
        Iso.SoundMediaHeaderBox = SoundMediaHeaderBox;
        var VideoMediaHeaderBox = (function (_super) {
            __extends(VideoMediaHeaderBox, _super);
            function VideoMediaHeaderBox(graphicsMode, opColor) {
                if (graphicsMode === void 0) { graphicsMode = 0; }
                if (opColor === void 0) { opColor = DEFAULT_OP_COLOR; }
                _super.call(this, 'vmhd', 0, 0);
                this.graphicsMode = graphicsMode;
                this.opColor = opColor;
            }
            VideoMediaHeaderBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 8;
                return this.size;
            };
            VideoMediaHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, (this.graphicsMode << 16) | this.opColor[0]);
                writeInt32(data, this.offset + offset + 4, (this.opColor[1] << 16) | this.opColor[2]);
                return offset + 8;
            };
            return VideoMediaHeaderBox;
        })(FullBox);
        Iso.VideoMediaHeaderBox = VideoMediaHeaderBox;
        Iso.SELF_CONTAINED_DATA_REFERENCE_FLAG = 0x000001;
        var DataEntryUrlBox = (function (_super) {
            __extends(DataEntryUrlBox, _super);
            function DataEntryUrlBox(flags, location) {
                if (location === void 0) { location = null; }
                _super.call(this, 'url ', 0, flags);
                this.location = location;
                if (!(flags & Iso.SELF_CONTAINED_DATA_REFERENCE_FLAG)) {
                    this._encodedLocation = utf8decode(location);
                }
            }
            DataEntryUrlBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset);
                if (this._encodedLocation) {
                    size += this._encodedLocation.length + 1;
                }
                return (this.size = size);
            };
            DataEntryUrlBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                if (this._encodedLocation) {
                    data.set(this._encodedLocation, this.offset + offset);
                    data[this.offset + offset + this._encodedLocation.length] = 0;
                    offset += this._encodedLocation.length;
                }
                return offset;
            };
            return DataEntryUrlBox;
        })(FullBox);
        Iso.DataEntryUrlBox = DataEntryUrlBox;
        var DataReferenceBox = (function (_super) {
            __extends(DataReferenceBox, _super);
            function DataReferenceBox(entries) {
                _super.call(this, 'dref', 0, 0);
                this.entries = entries;
            }
            DataReferenceBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset) + 4;
                this.entries.forEach(function (entry) {
                    size += entry.layout(offset + size);
                });
                return (this.size = size);
            };
            DataReferenceBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, this.entries.length);
                this.entries.forEach(function (entry) {
                    offset += entry.write(data);
                });
                return offset;
            };
            return DataReferenceBox;
        })(FullBox);
        Iso.DataReferenceBox = DataReferenceBox;
        var DataInformationBox = (function (_super) {
            __extends(DataInformationBox, _super);
            function DataInformationBox(dataReference) {
                _super.call(this, 'dinf', [dataReference]);
                this.dataReference = dataReference;
            }
            return DataInformationBox;
        })(BoxContainerBox);
        Iso.DataInformationBox = DataInformationBox;
        var SampleDescriptionBox = (function (_super) {
            __extends(SampleDescriptionBox, _super);
            function SampleDescriptionBox(entries) {
                _super.call(this, 'stsd', 0, 0);
                this.entries = entries;
            }
            SampleDescriptionBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset);
                size += 4;
                this.entries.forEach(function (entry) {
                    size += entry.layout(offset + size);
                });
                return (this.size = size);
            };
            SampleDescriptionBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, this.entries.length);
                offset += 4;
                this.entries.forEach(function (entry) {
                    offset += entry.write(data);
                });
                return offset;
            };
            return SampleDescriptionBox;
        })(FullBox);
        Iso.SampleDescriptionBox = SampleDescriptionBox;
        var SampleTableBox = (function (_super) {
            __extends(SampleTableBox, _super);
            function SampleTableBox(sampleDescriptions, timeToSample, sampleToChunk, sampleSizes, // optional?
                chunkOffset) {
                _super.call(this, 'stbl', [sampleDescriptions, timeToSample, sampleToChunk, sampleSizes, chunkOffset]);
                this.sampleDescriptions = sampleDescriptions;
                this.timeToSample = timeToSample;
                this.sampleToChunk = sampleToChunk;
                this.sampleSizes = sampleSizes;
                this.chunkOffset = chunkOffset;
            }
            return SampleTableBox;
        })(BoxContainerBox);
        Iso.SampleTableBox = SampleTableBox;
        var MediaInformationBox = (function (_super) {
            __extends(MediaInformationBox, _super);
            function MediaInformationBox(header, // SoundMediaHeaderBox|VideoMediaHeaderBox
                info, sampleTable) {
                _super.call(this, 'minf', [header, info, sampleTable]);
                this.header = header;
                this.info = info;
                this.sampleTable = sampleTable;
            }
            return MediaInformationBox;
        })(BoxContainerBox);
        Iso.MediaInformationBox = MediaInformationBox;
        var MediaBox = (function (_super) {
            __extends(MediaBox, _super);
            function MediaBox(header, handler, info) {
                _super.call(this, 'mdia', [header, handler, info]);
                this.header = header;
                this.handler = handler;
                this.info = info;
            }
            return MediaBox;
        })(BoxContainerBox);
        Iso.MediaBox = MediaBox;
        var TrackBox = (function (_super) {
            __extends(TrackBox, _super);
            function TrackBox(header, media) {
                _super.call(this, 'trak', [header, media]);
                this.header = header;
                this.media = media;
            }
            return TrackBox;
        })(BoxContainerBox);
        Iso.TrackBox = TrackBox;
        var TrackExtendsBox = (function (_super) {
            __extends(TrackExtendsBox, _super);
            function TrackExtendsBox(trackId, defaultSampleDescriptionIndex, defaultSampleDuration, defaultSampleSize, defaultSampleFlags) {
                _super.call(this, 'trex', 0, 0);
                this.trackId = trackId;
                this.defaultSampleDescriptionIndex = defaultSampleDescriptionIndex;
                this.defaultSampleDuration = defaultSampleDuration;
                this.defaultSampleSize = defaultSampleSize;
                this.defaultSampleFlags = defaultSampleFlags;
            }
            TrackExtendsBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 20;
                return this.size;
            };
            TrackExtendsBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, this.trackId);
                writeInt32(data, this.offset + offset + 4, this.defaultSampleDescriptionIndex);
                writeInt32(data, this.offset + offset + 8, this.defaultSampleDuration);
                writeInt32(data, this.offset + offset + 12, this.defaultSampleSize);
                writeInt32(data, this.offset + offset + 16, this.defaultSampleFlags);
                return offset + 20;
            };
            return TrackExtendsBox;
        })(FullBox);
        Iso.TrackExtendsBox = TrackExtendsBox;
        var MovieExtendsBox = (function (_super) {
            __extends(MovieExtendsBox, _super);
            function MovieExtendsBox(header, tracDefaults, levels) {
                _super.call(this, 'mvex', concatArrays([header], tracDefaults, [levels]));
                this.header = header;
                this.tracDefaults = tracDefaults;
                this.levels = levels;
            }
            return MovieExtendsBox;
        })(BoxContainerBox);
        Iso.MovieExtendsBox = MovieExtendsBox;
        var MetaBox = (function (_super) {
            __extends(MetaBox, _super);
            function MetaBox(handler, otherBoxes) {
                _super.call(this, 'meta', 0, 0);
                this.handler = handler;
                this.otherBoxes = otherBoxes;
            }
            MetaBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset);
                size += this.handler.layout(offset + size);
                this.otherBoxes.forEach(function (box) {
                    size += box.layout(offset + size);
                });
                return (this.size = size);
            };
            MetaBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                offset += this.handler.write(data);
                this.otherBoxes.forEach(function (box) {
                    offset += box.write(data);
                });
                return offset;
            };
            return MetaBox;
        })(FullBox);
        Iso.MetaBox = MetaBox;
        var MovieFragmentHeaderBox = (function (_super) {
            __extends(MovieFragmentHeaderBox, _super);
            function MovieFragmentHeaderBox(sequenceNumber) {
                _super.call(this, 'mfhd', 0, 0);
                this.sequenceNumber = sequenceNumber;
            }
            MovieFragmentHeaderBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 4;
                return this.size;
            };
            MovieFragmentHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, this.sequenceNumber);
                return offset + 4;
            };
            return MovieFragmentHeaderBox;
        })(FullBox);
        Iso.MovieFragmentHeaderBox = MovieFragmentHeaderBox;
        (function (TrackFragmentFlags) {
            TrackFragmentFlags[TrackFragmentFlags["BASE_DATA_OFFSET_PRESENT"] = 1] = "BASE_DATA_OFFSET_PRESENT";
            TrackFragmentFlags[TrackFragmentFlags["SAMPLE_DESCRIPTION_INDEX_PRESENT"] = 2] = "SAMPLE_DESCRIPTION_INDEX_PRESENT";
            TrackFragmentFlags[TrackFragmentFlags["DEFAULT_SAMPLE_DURATION_PRESENT"] = 8] = "DEFAULT_SAMPLE_DURATION_PRESENT";
            TrackFragmentFlags[TrackFragmentFlags["DEFAULT_SAMPLE_SIZE_PRESENT"] = 16] = "DEFAULT_SAMPLE_SIZE_PRESENT";
            TrackFragmentFlags[TrackFragmentFlags["DEFAULT_SAMPLE_FLAGS_PRESENT"] = 32] = "DEFAULT_SAMPLE_FLAGS_PRESENT";
        })(Iso.TrackFragmentFlags || (Iso.TrackFragmentFlags = {}));
        var TrackFragmentFlags = Iso.TrackFragmentFlags;
        var TrackFragmentHeaderBox = (function (_super) {
            __extends(TrackFragmentHeaderBox, _super);
            function TrackFragmentHeaderBox(flags, trackId, baseDataOffset, sampleDescriptionIndex, defaultSampleDuration, defaultSampleSize, defaultSampleFlags) {
                _super.call(this, 'tfhd', 0, flags);
                this.trackId = trackId;
                this.baseDataOffset = baseDataOffset;
                this.sampleDescriptionIndex = sampleDescriptionIndex;
                this.defaultSampleDuration = defaultSampleDuration;
                this.defaultSampleSize = defaultSampleSize;
                this.defaultSampleFlags = defaultSampleFlags;
            }
            TrackFragmentHeaderBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset) + 4;
                var flags = this.flags;
                if (!!(flags & TrackFragmentFlags.BASE_DATA_OFFSET_PRESENT)) {
                    size += 8;
                }
                if (!!(flags & TrackFragmentFlags.SAMPLE_DESCRIPTION_INDEX_PRESENT)) {
                    size += 4;
                }
                if (!!(flags & TrackFragmentFlags.DEFAULT_SAMPLE_DURATION_PRESENT)) {
                    size += 4;
                }
                if (!!(flags & TrackFragmentFlags.DEFAULT_SAMPLE_SIZE_PRESENT)) {
                    size += 4;
                }
                if (!!(flags & TrackFragmentFlags.DEFAULT_SAMPLE_FLAGS_PRESENT)) {
                    size += 4;
                }
                return (this.size = size);
            };
            TrackFragmentHeaderBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                var flags = this.flags;
                writeInt32(data, this.offset + offset, this.trackId);
                offset += 4;
                if (!!(flags & TrackFragmentFlags.BASE_DATA_OFFSET_PRESENT)) {
                    writeInt32(data, this.offset + offset, 0);
                    writeInt32(data, this.offset + offset + 4, this.baseDataOffset);
                    offset += 8;
                }
                if (!!(flags & TrackFragmentFlags.SAMPLE_DESCRIPTION_INDEX_PRESENT)) {
                    writeInt32(data, this.offset + offset, this.sampleDescriptionIndex);
                    offset += 4;
                }
                if (!!(flags & TrackFragmentFlags.DEFAULT_SAMPLE_DURATION_PRESENT)) {
                    writeInt32(data, this.offset + offset, this.defaultSampleDuration);
                    offset += 4;
                }
                if (!!(flags & TrackFragmentFlags.DEFAULT_SAMPLE_SIZE_PRESENT)) {
                    writeInt32(data, this.offset + offset, this.defaultSampleSize);
                    offset += 4;
                }
                if (!!(flags & TrackFragmentFlags.DEFAULT_SAMPLE_FLAGS_PRESENT)) {
                    writeInt32(data, this.offset + offset, this.defaultSampleFlags);
                    offset += 4;
                }
                return offset;
            };
            return TrackFragmentHeaderBox;
        })(FullBox);
        Iso.TrackFragmentHeaderBox = TrackFragmentHeaderBox;
        var TrackFragmentBaseMediaDecodeTimeBox = (function (_super) {
            __extends(TrackFragmentBaseMediaDecodeTimeBox, _super);
            function TrackFragmentBaseMediaDecodeTimeBox(baseMediaDecodeTime) {
                _super.call(this, 'tfdt', 0, 0);
                this.baseMediaDecodeTime = baseMediaDecodeTime;
            }
            TrackFragmentBaseMediaDecodeTimeBox.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 4;
                return this.size;
            };
            TrackFragmentBaseMediaDecodeTimeBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, this.baseMediaDecodeTime);
                return offset + 4;
            };
            return TrackFragmentBaseMediaDecodeTimeBox;
        })(FullBox);
        Iso.TrackFragmentBaseMediaDecodeTimeBox = TrackFragmentBaseMediaDecodeTimeBox;
        var TrackFragmentBox = (function (_super) {
            __extends(TrackFragmentBox, _super);
            function TrackFragmentBox(header, decodeTime, // move after run?
                run) {
                _super.call(this, 'traf', [header, decodeTime, run]);
                this.header = header;
                this.decodeTime = decodeTime;
                this.run = run;
            }
            return TrackFragmentBox;
        })(BoxContainerBox);
        Iso.TrackFragmentBox = TrackFragmentBox;
        (function (SampleFlags) {
            SampleFlags[SampleFlags["IS_LEADING_MASK"] = 201326592] = "IS_LEADING_MASK";
            SampleFlags[SampleFlags["SAMPLE_DEPENDS_ON_MASK"] = 50331648] = "SAMPLE_DEPENDS_ON_MASK";
            SampleFlags[SampleFlags["SAMPLE_DEPENDS_ON_OTHER"] = 16777216] = "SAMPLE_DEPENDS_ON_OTHER";
            SampleFlags[SampleFlags["SAMPLE_DEPENDS_ON_NO_OTHERS"] = 33554432] = "SAMPLE_DEPENDS_ON_NO_OTHERS";
            SampleFlags[SampleFlags["SAMPLE_IS_DEPENDED_ON_MASK"] = 12582912] = "SAMPLE_IS_DEPENDED_ON_MASK";
            SampleFlags[SampleFlags["SAMPLE_HAS_REDUNDANCY_MASK"] = 3145728] = "SAMPLE_HAS_REDUNDANCY_MASK";
            SampleFlags[SampleFlags["SAMPLE_PADDING_VALUE_MASK"] = 917504] = "SAMPLE_PADDING_VALUE_MASK";
            SampleFlags[SampleFlags["SAMPLE_IS_NOT_SYNC"] = 65536] = "SAMPLE_IS_NOT_SYNC";
            SampleFlags[SampleFlags["SAMPLE_DEGRADATION_PRIORITY_MASK"] = 65535] = "SAMPLE_DEGRADATION_PRIORITY_MASK";
        })(Iso.SampleFlags || (Iso.SampleFlags = {}));
        var SampleFlags = Iso.SampleFlags;
        (function (TrackRunFlags) {
            TrackRunFlags[TrackRunFlags["DATA_OFFSET_PRESENT"] = 1] = "DATA_OFFSET_PRESENT";
            TrackRunFlags[TrackRunFlags["FIRST_SAMPLE_FLAGS_PRESENT"] = 4] = "FIRST_SAMPLE_FLAGS_PRESENT";
            TrackRunFlags[TrackRunFlags["SAMPLE_DURATION_PRESENT"] = 256] = "SAMPLE_DURATION_PRESENT";
            TrackRunFlags[TrackRunFlags["SAMPLE_SIZE_PRESENT"] = 512] = "SAMPLE_SIZE_PRESENT";
            TrackRunFlags[TrackRunFlags["SAMPLE_FLAGS_PRESENT"] = 1024] = "SAMPLE_FLAGS_PRESENT";
            TrackRunFlags[TrackRunFlags["SAMPLE_COMPOSITION_TIME_OFFSET"] = 2048] = "SAMPLE_COMPOSITION_TIME_OFFSET";
        })(Iso.TrackRunFlags || (Iso.TrackRunFlags = {}));
        var TrackRunFlags = Iso.TrackRunFlags;
        var TrackRunBox = (function (_super) {
            __extends(TrackRunBox, _super);
            function TrackRunBox(flags, samples, dataOffset, firstSampleFlags) {
                _super.call(this, 'trun', 1, flags);
                this.samples = samples;
                this.dataOffset = dataOffset;
                this.firstSampleFlags = firstSampleFlags;
            }
            TrackRunBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset) + 4;
                var samplesCount = this.samples.length;
                var flags = this.flags;
                if (!!(flags & TrackRunFlags.DATA_OFFSET_PRESENT)) {
                    size += 4;
                }
                if (!!(flags & TrackRunFlags.FIRST_SAMPLE_FLAGS_PRESENT)) {
                    size += 4;
                }
                if (!!(flags & TrackRunFlags.SAMPLE_DURATION_PRESENT)) {
                    size += 4 * samplesCount;
                }
                if (!!(flags & TrackRunFlags.SAMPLE_SIZE_PRESENT)) {
                    size += 4 * samplesCount;
                }
                if (!!(flags & TrackRunFlags.SAMPLE_FLAGS_PRESENT)) {
                    size += 4 * samplesCount;
                }
                if (!!(flags & TrackRunFlags.SAMPLE_COMPOSITION_TIME_OFFSET)) {
                    size += 4 * samplesCount;
                }
                return (this.size = size);
            };
            TrackRunBox.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                var samplesCount = this.samples.length;
                var flags = this.flags;
                writeInt32(data, this.offset + offset, samplesCount);
                offset += 4;
                if (!!(flags & TrackRunFlags.DATA_OFFSET_PRESENT)) {
                    writeInt32(data, this.offset + offset, this.dataOffset);
                    offset += 4;
                }
                if (!!(flags & TrackRunFlags.FIRST_SAMPLE_FLAGS_PRESENT)) {
                    writeInt32(data, this.offset + offset, this.firstSampleFlags);
                    offset += 4;
                }
                for (var i = 0; i < samplesCount; i++) {
                    var sample = this.samples[i];
                    if (!!(flags & TrackRunFlags.SAMPLE_DURATION_PRESENT)) {
                        writeInt32(data, this.offset + offset, sample.duration);
                        offset += 4;
                    }
                    if (!!(flags & TrackRunFlags.SAMPLE_SIZE_PRESENT)) {
                        writeInt32(data, this.offset + offset, sample.size);
                        offset += 4;
                    }
                    if (!!(flags & TrackRunFlags.SAMPLE_FLAGS_PRESENT)) {
                        writeInt32(data, this.offset + offset, sample.flags);
                        offset += 4;
                    }
                    if (!!(flags & TrackRunFlags.SAMPLE_COMPOSITION_TIME_OFFSET)) {
                        writeInt32(data, this.offset + offset, sample.compositionTimeOffset);
                        offset += 4;
                    }
                }
                return offset;
            };
            return TrackRunBox;
        })(FullBox);
        Iso.TrackRunBox = TrackRunBox;
        var MovieFragmentBox = (function (_super) {
            __extends(MovieFragmentBox, _super);
            function MovieFragmentBox(header, trafs) {
                _super.call(this, 'moof', concatArrays([header], trafs));
                this.header = header;
                this.trafs = trafs;
            }
            return MovieFragmentBox;
        })(BoxContainerBox);
        Iso.MovieFragmentBox = MovieFragmentBox;
        var MediaDataBox = (function (_super) {
            __extends(MediaDataBox, _super);
            function MediaDataBox(chunks) {
                _super.call(this, 'mdat');
                this.chunks = chunks;
            }
            MediaDataBox.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset);
                this.chunks.forEach(function (chunk) { size += chunk.length; });
                return (this.size = size);
            };
            MediaDataBox.prototype.write = function (data) {
                var _this = this;
                var offset = _super.prototype.write.call(this, data);
                this.chunks.forEach(function (chunk) {
                    data.set(chunk, _this.offset + offset);
                    offset += chunk.length;
                }, this);
                return offset;
            };
            return MediaDataBox;
        })(Box);
        Iso.MediaDataBox = MediaDataBox;
        var SampleEntry = (function (_super) {
            __extends(SampleEntry, _super);
            function SampleEntry(format, dataReferenceIndex) {
                _super.call(this, format);
                this.dataReferenceIndex = dataReferenceIndex;
            }
            SampleEntry.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + 8;
                return this.size;
            };
            SampleEntry.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, this.dataReferenceIndex);
                return offset + 8;
            };
            return SampleEntry;
        })(Box);
        Iso.SampleEntry = SampleEntry;
        var AudioSampleEntry = (function (_super) {
            __extends(AudioSampleEntry, _super);
            function AudioSampleEntry(codingName, dataReferenceIndex, channelCount, sampleSize, sampleRate, otherBoxes) {
                if (channelCount === void 0) { channelCount = 2; }
                if (sampleSize === void 0) { sampleSize = 16; }
                if (sampleRate === void 0) { sampleRate = 44100; }
                if (otherBoxes === void 0) { otherBoxes = null; }
                _super.call(this, codingName, dataReferenceIndex);
                this.channelCount = channelCount;
                this.sampleSize = sampleSize;
                this.sampleRate = sampleRate;
                this.otherBoxes = otherBoxes;
            }
            AudioSampleEntry.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset) + 20;
                this.otherBoxes && this.otherBoxes.forEach(function (box) {
                    size += box.layout(offset + size);
                });
                return (this.size = size);
            };
            AudioSampleEntry.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, 0);
                writeInt32(data, this.offset + offset + 8, (this.channelCount << 16) | this.sampleSize);
                writeInt32(data, this.offset + offset + 12, 0);
                writeInt32(data, this.offset + offset + 16, (this.sampleRate << 16));
                offset += 20;
                this.otherBoxes && this.otherBoxes.forEach(function (box) {
                    offset += box.write(data);
                });
                return offset;
            };
            return AudioSampleEntry;
        })(SampleEntry);
        Iso.AudioSampleEntry = AudioSampleEntry;
        Iso.COLOR_NO_ALPHA_VIDEO_SAMPLE_DEPTH = 0x0018;
        var VideoSampleEntry = (function (_super) {
            __extends(VideoSampleEntry, _super);
            function VideoSampleEntry(codingName, dataReferenceIndex, width, height, compressorName, horizResolution, vertResolution, frameCount, depth, otherBoxes) {
                if (compressorName === void 0) { compressorName = ''; }
                if (horizResolution === void 0) { horizResolution = 72; }
                if (vertResolution === void 0) { vertResolution = 72; }
                if (frameCount === void 0) { frameCount = 1; }
                if (depth === void 0) { depth = Iso.COLOR_NO_ALPHA_VIDEO_SAMPLE_DEPTH; }
                if (otherBoxes === void 0) { otherBoxes = null; }
                _super.call(this, codingName, dataReferenceIndex);
                this.width = width;
                this.height = height;
                this.compressorName = compressorName;
                this.horizResolution = horizResolution;
                this.vertResolution = vertResolution;
                this.frameCount = frameCount;
                this.depth = depth;
                this.otherBoxes = otherBoxes;
                if (compressorName.length > 31) {
                    throw new Error('invalid compressor name');
                }
            }
            VideoSampleEntry.prototype.layout = function (offset) {
                var size = _super.prototype.layout.call(this, offset) + 16 + 12 + 4 + 2 + 32 + 2 + 2;
                this.otherBoxes && this.otherBoxes.forEach(function (box) {
                    size += box.layout(offset + size);
                });
                return (this.size = size);
            };
            VideoSampleEntry.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, 0);
                writeInt32(data, this.offset + offset + 8, 0);
                writeInt32(data, this.offset + offset + 12, 0);
                offset += 16;
                writeInt32(data, this.offset + offset, (this.width << 16) | this.height);
                writeInt32(data, this.offset + offset + 4, encodeFloat_16_16(this.horizResolution));
                writeInt32(data, this.offset + offset + 8, encodeFloat_16_16(this.vertResolution));
                offset += 12;
                writeInt32(data, this.offset + offset, 0);
                writeInt32(data, this.offset + offset + 4, (this.frameCount << 16));
                offset += 6; // weird offset
                data[this.offset + offset] = this.compressorName.length;
                for (var i = 0; i < 31; i++) {
                    data[this.offset + offset + i + 1] = i < this.compressorName.length ? (this.compressorName.charCodeAt(i) & 127) : 0;
                }
                offset += 32;
                writeInt32(data, this.offset + offset, (this.depth << 16) | 0xFFFF);
                offset += 4;
                this.otherBoxes && this.otherBoxes.forEach(function (box) {
                    offset += box.write(data);
                });
                return offset;
            };
            return VideoSampleEntry;
        })(SampleEntry);
        Iso.VideoSampleEntry = VideoSampleEntry;
        var RawTag = (function (_super) {
            __extends(RawTag, _super);
            function RawTag(type, data) {
                _super.call(this, type);
                this.data = data;
            }
            RawTag.prototype.layout = function (offset) {
                this.size = _super.prototype.layout.call(this, offset) + this.data.length;
                return this.size;
            };
            RawTag.prototype.write = function (data) {
                var offset = _super.prototype.write.call(this, data);
                data.set(this.data, this.offset + offset);
                return offset + this.data.length;
            };
            return RawTag;
        })(Box);
        Iso.RawTag = RawTag;
        
        return Iso;
    })();

    var MP4Mux = (function() {
        var MP4Iso = Iso;
        
        function hex(s) {
            var len = s.length >> 1;
            var arr = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
                arr[i] = parseInt(s.substr(i * 2, 2), 16);
            }
            return arr;
        }
        var SOUNDRATES = [5500, 11025, 22050, 44100];
        var SOUNDFORMATS = ['PCM',
                            'ADPCM',
                            'MP3',
                            'PCM le',
                            'Nellymouser16',
                            'Nellymouser8',
                            'Nellymouser',
                            'G.711 A-law',
                            'G.711 mu-law',
                            null,
                            'AAC',
                            'Speex',
                            'MP3 8khz'];
        
        var MP3_SOUND_CODEC_ID = 2;
        var AAC_SOUND_CODEC_ID = 10;
        
        var AudioPacketType;
        (function (AudioPacketType) {
            AudioPacketType[AudioPacketType["HEADER"] = 0] = "HEADER";
            AudioPacketType[AudioPacketType["RAW"] = 1] = "RAW";
        })(AudioPacketType || (AudioPacketType = {}));
        function parseAudiodata(data) {
            var i = 0;
            var packetType = AudioPacketType.RAW;
            var samples;
            var buf = data[i];
            var codecId = buf >> 4;
            var rate = buf >> 2 & 3;
            var size = buf & 2 ? 16 : 8;
            var channels = buf & 1 ? 2 : 1;
            
            switch (i++, codecId) {
                case AAC_SOUND_CODEC_ID:
                    var type = data[i++];
                    packetType = type;
                    samples = 1024; // AAC implementations typically represent 1024 PCM audio samples
                    break;
                case MP3_SOUND_CODEC_ID:
                    var version = (data[i + 1] >> 3) & 3; // 3 - MPEG 1
                    var layer = (data[i + 1] >> 1) & 3; // 3 - Layer I, 2 - II, 1 - III
        
        /*
        Sign  Length
        (bits)  Position
        (bits)  Description
        A 11  (31-21) Frame sync (all bits set)
        B 2 (20,19) MPEG Audio version ID
        00 - MPEG Version 2.5
        01 - reserved
        10 - MPEG Version 2 (ISO/IEC 13818-3)
        11 - MPEG Version 1 (ISO/IEC 11172-3)
        Note: MPEG Version 2.5 is not official standard. Bit No 20 in frame header is used to indicate version 2.5. Applications that do not support this MPEG version expect this bit always to be set, meaning that frame sync (A) is twelve bits long, not eleve as stated here. Accordingly, B is one bit long (represents only bit No 19). I recommend using methodology presented here, since this allows you to distinguish all three versions and keep full compatibility.
        
        C 2 (18,17) Layer description
        00 - reserved
        01 - Layer III
        10 - Layer II
        11 - Layer I
        D 1 (16)  Protection bit
        0 - Protected by CRC (16bit crc follows header)
        1 - Not protected
        */
                    samples = layer === 1 ? (version === 3 ? 1152 : 576) : (layer === 3 ? 384 : 1152);
                    break;
            }
            info = {
              codecDescription: SOUNDFORMATS[codecId],
              codecId: codecId,
              data: data.subarray(i),
              rate: rate,
              size: size,
              channels: channels,
              samples: samples,
              packetType: packetType
            };
            
            return info;
        }
        var VIDEOCODECS = [null, 'JPEG', 'Sorenson', 'Screen', 'VP6', 'VP6 alpha', 'Screen2', 'AVC'];
        var VP6_VIDEO_CODEC_ID = 4;
        var AVC_VIDEO_CODEC_ID = 7;
        var VideoFrameType;
        (function (VideoFrameType) {
            VideoFrameType[VideoFrameType["KEY"] = 1] = "KEY";
            VideoFrameType[VideoFrameType["INNER"] = 2] = "INNER";
            VideoFrameType[VideoFrameType["DISPOSABLE"] = 3] = "DISPOSABLE";
            VideoFrameType[VideoFrameType["GENERATED"] = 4] = "GENERATED";
            VideoFrameType[VideoFrameType["INFO"] = 5] = "INFO";
        })(VideoFrameType || (VideoFrameType = {}));
        var VideoPacketType;
        (function (VideoPacketType) {
            VideoPacketType[VideoPacketType["HEADER"] = 0] = "HEADER";
            VideoPacketType[VideoPacketType["NALU"] = 1] = "NALU";
            VideoPacketType[VideoPacketType["END"] = 2] = "END";
        })(VideoPacketType || (VideoPacketType = {}));
        function parseVideodata(data) {
            var i = 0;
            var frameType = data[i] >> 4;
            var codecId = data[i] & 15;
            i++;
            var result = {
                frameType: frameType,
                codecId: codecId,
                codecDescription: VIDEOCODECS[codecId]
            };
            switch (codecId) {
                case AVC_VIDEO_CODEC_ID:
                    var type = data[i++];
                    result.packetType = type;
                    result.compositionTime = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8)) >> 8;
                    i += 3;
                    break;
                case VP6_VIDEO_CODEC_ID:
                    result.packetType = VideoPacketType.NALU;
                    result.horizontalOffset = (data[i] >> 4) & 15;
                    result.verticalOffset = data[i] & 15;
                    result.compositionTime = 0;
                    i++;
                    break;
            }
            result.data = data.subarray(i);
            return result;
        }
        var AUDIO_PACKET = 8;
        var VIDEO_PACKET = 9;
        var MAX_PACKETS_IN_CHUNK = 50;
        var SPLIT_AT_KEYFRAMES = true;
        var MP4MuxState;
        (function (MP4MuxState) {
            MP4MuxState[MP4MuxState["CAN_GENERATE_HEADER"] = 0] = "CAN_GENERATE_HEADER";
            MP4MuxState[MP4MuxState["NEED_HEADER_DATA"] = 1] = "NEED_HEADER_DATA";
            MP4MuxState[MP4MuxState["MAIN_PACKETS"] = 2] = "MAIN_PACKETS";
        })(MP4MuxState || (MP4MuxState = {}));
        var MP4Mux = (function () {
            function MP4Mux(metadata) {
                var _this = this;
                this.oncodecinfo = function (codecs) {
                    //throw new Error('MP4Mux.oncodecinfo is not set');
                };
                this.ondata = function (data) {
                    throw new Error('MP4Mux.ondata is not set');
                };
                this.metadata = metadata;
                this.trackStates = this.metadata.tracks.map(function (t, index) {
                    var state = {
                        trackId: index + 1,
                        trackInfo: t,
                        cachedDuration: 0,
                        samplesProcessed: 0,
                        initializationData: []
                    };
                    if (_this.metadata.audioTrackId === index) {
                        _this.audioTrackState = state;
                    }
                    if (_this.metadata.videoTrackId === index) {
                        _this.videoTrackState = state;
                    }
                    return state;
                }, this);
                this._checkIfNeedHeaderData();
                this.filePos = 0;
                this.cachedPackets = [];
                this.chunkIndex = 0;
            }
        
            MP4Mux.prototype.pushPacket = function (type, data, timestamp) {
                if (this.state === MP4MuxState.CAN_GENERATE_HEADER) {
                    this._tryGenerateHeader();
                }
                switch (type) {
                    case AUDIO_PACKET:
                        var audioTrack = this.audioTrackState;
                        var audioPacket = parseAudiodata(data);
                        if (!audioTrack || audioTrack.trackInfo.codecId !== audioPacket.codecId) {
                            throw new Error('Unexpected audio packet codec: ' + audioPacket.codecDescription);
                        }
                        switch (audioPacket.codecId) {
                            default:
                                throw new Error('Unsupported audio codec: ' + audioPacket.codecDescription);
                            case MP3_SOUND_CODEC_ID:
                                break; // supported codec
                            case AAC_SOUND_CODEC_ID:
                                if (audioPacket.packetType === AudioPacketType.HEADER) {
                                    audioTrack.initializationData.push(audioPacket.data);
                                    return;
                                }
                                break;
                        }
                        this.cachedPackets.push({ packet: audioPacket, timestamp: timestamp, trackId: audioTrack.trackId });
                        break;
                    case VIDEO_PACKET:
                        var videoTrack = this.videoTrackState;
                        var videoPacket = parseVideodata(data);
                        if (!videoTrack || videoTrack.trackInfo.codecId !== videoPacket.codecId) {
                            throw new Error('Unexpected video packet codec: ' + videoPacket.codecDescription);
                        }
                        switch (videoPacket.codecId) {
                            default:
                                throw new Error('unsupported video codec: ' + videoPacket.codecDescription);
                            case VP6_VIDEO_CODEC_ID:
                                break; // supported
                            case AVC_VIDEO_CODEC_ID:
                                if (videoPacket.packetType === VideoPacketType.HEADER) {
                                    videoTrack.initializationData.push(videoPacket.data);
                                    return;
                                }
                                break;
                        }
                        this.cachedPackets.push({ packet: videoPacket, timestamp: timestamp, trackId: videoTrack.trackId });
                        break;
                    default:
                        throw new Error('unknown packet type: ' + type);
                }
                if (this.state === MP4MuxState.NEED_HEADER_DATA) {
                    this._tryGenerateHeader();
                }
                /*
                if (this.cachedPackets.length >= MAX_PACKETS_IN_CHUNK &&
                    this.state === MP4MuxState.MAIN_PACKETS) {
                    this._chunk();
                }
                */
            };
            MP4Mux.prototype.flush = function (resetBaseMediaDecodeTime) {
                if (this.cachedPackets.length > 0) {
                    this._chunk();
                }
                // reset all track's cached duration to zero
                if (resetBaseMediaDecodeTime) {
                    for (var i = 0; i < this.trackStates.length; i++) {
                        this.trackStates[i].cachedDuration = 0;
                    }
                }
            };
            MP4Mux.prototype._checkIfNeedHeaderData = function () {
                if (this.trackStates.some(function (ts) {
                    return ts.trackInfo.codecId === AAC_SOUND_CODEC_ID || ts.trackInfo.codecId === AVC_VIDEO_CODEC_ID;
                })) {
                    this.state = MP4MuxState.NEED_HEADER_DATA;
                }
                else {
                    this.state = MP4MuxState.CAN_GENERATE_HEADER;
                }
            };
            MP4Mux.prototype._tryGenerateHeader = function () {
                var allInitializationDataExists = this.trackStates.every(function (ts) {
                    switch (ts.trackInfo.codecId) {
                        case AAC_SOUND_CODEC_ID:
                        case AVC_VIDEO_CODEC_ID:
                            return ts.initializationData.length > 0;
                        default:
                            return true;
                    }
                });
                if (!allInitializationDataExists) {
                    return; // not enough data, waiting more
                }
                var brands = ['isom'];
                var audioDataReferenceIndex = 1, videoDataReferenceIndex = 1;
                var traks = [];
                for (var i = 0; i < this.trackStates.length; i++) {
                    var trackState = this.trackStates[i];
                    var trackInfo = trackState.trackInfo;
                    var sampleEntry;
                    switch (trackInfo.codecId) {
                        case AAC_SOUND_CODEC_ID:
                            var audioSpecificConfig = trackState.initializationData[0];
                            sampleEntry = new MP4Iso.AudioSampleEntry('mp4a', audioDataReferenceIndex, trackInfo.channels, trackInfo.samplesize, trackInfo.samplerate);
                            var esdsData = new Uint8Array(41 + audioSpecificConfig.length);
                            esdsData.set(hex('0000000003808080'), 0);
                            esdsData[8] = 32 + audioSpecificConfig.length;
                            esdsData.set(hex('00020004808080'), 9);
                            esdsData[16] = 18 + audioSpecificConfig.length;
                            esdsData.set(hex('40150000000000FA000000000005808080'), 17);
                            esdsData[34] = audioSpecificConfig.length;
                            esdsData.set(audioSpecificConfig, 35);
                            esdsData.set(hex('068080800102'), 35 + audioSpecificConfig.length);
                            sampleEntry.otherBoxes = [
                                new MP4Iso.RawTag('esds', esdsData)
                            ];
                            var objectType = (audioSpecificConfig[0] >> 3); // TODO 31
                            // mp4a.40.objectType
                            trackState.mimeTypeCodec = 'mp4a.40.' + objectType;
                            break;
                        case MP3_SOUND_CODEC_ID:
                            sampleEntry = new MP4Iso.AudioSampleEntry('.mp3', audioDataReferenceIndex, trackInfo.channels, trackInfo.samplesize, trackInfo.samplerate);
                            trackState.mimeTypeCodec = 'mp3';
                            break;
                        case AVC_VIDEO_CODEC_ID:
                            var avcC = trackState.initializationData[0];
                            sampleEntry = new MP4Iso.VideoSampleEntry('avc1', videoDataReferenceIndex, trackInfo.width, trackInfo.height);
                            sampleEntry.otherBoxes = [
                                new MP4Iso.RawTag('avcC', avcC)
                            ];
                            var codecProfile = (avcC[1] << 16) | (avcC[2] << 8) | avcC[3];
                            // avc1.XXYYZZ -- XX - profile + YY - constraints + ZZ - level
                            trackState.mimeTypeCodec = 'avc1.' + (0x1000000 | codecProfile).toString(16).substr(1);
                            brands.push('iso2', 'avc1', 'mp41');
                            break;
                        case VP6_VIDEO_CODEC_ID:
                            sampleEntry = new MP4Iso.VideoSampleEntry('VP6F', videoDataReferenceIndex, trackInfo.width, trackInfo.height);
                            sampleEntry.otherBoxes = [
                                new MP4Iso.RawTag('glbl', hex('00'))
                            ];
                            // TODO to lie about codec to get it playing in MSE?
                            trackState.mimeTypeCodec = 'avc1.42001E';
                            break;
                        default:
                            throw new Error('not supported track type');
                    }
                    var trak;
                    var trakFlags = MP4Iso.TrackHeaderFlags.TRACK_ENABLED | MP4Iso.TrackHeaderFlags.TRACK_IN_MOVIE;
                    if (trackState === this.audioTrackState) {
                        trak = new MP4Iso.TrackBox(new MP4Iso.TrackHeaderBox(trakFlags, trackState.trackId, -1, 0 /*width*/, 0 /*height*/, 1.0, i), new MP4Iso.MediaBox(new MP4Iso.MediaHeaderBox(trackInfo.timescale, -1, trackInfo.language), new MP4Iso.HandlerBox('soun', 'SoundHandler'), new MP4Iso.MediaInformationBox(new MP4Iso.SoundMediaHeaderBox(), new MP4Iso.DataInformationBox(new MP4Iso.DataReferenceBox([new MP4Iso.DataEntryUrlBox(MP4Iso.SELF_CONTAINED_DATA_REFERENCE_FLAG)])), new MP4Iso.SampleTableBox(new MP4Iso.SampleDescriptionBox([sampleEntry]), new MP4Iso.RawTag('stts', hex('0000000000000000')), new MP4Iso.RawTag('stsc', hex('0000000000000000')), new MP4Iso.RawTag('stsz', hex('000000000000000000000000')), new MP4Iso.RawTag('stco', hex('0000000000000000'))))));
                    }
                    else if (trackState === this.videoTrackState) {
                        trak = new MP4Iso.TrackBox(new MP4Iso.TrackHeaderBox(trakFlags, trackState.trackId, -1, trackInfo.width, trackInfo.height, 0 /* volume */, i), new MP4Iso.MediaBox(new MP4Iso.MediaHeaderBox(trackInfo.timescale, -1, trackInfo.language), new MP4Iso.HandlerBox('vide', 'VideoHandler'), new MP4Iso.MediaInformationBox(new MP4Iso.VideoMediaHeaderBox(), new MP4Iso.DataInformationBox(new MP4Iso.DataReferenceBox([new MP4Iso.DataEntryUrlBox(MP4Iso.SELF_CONTAINED_DATA_REFERENCE_FLAG)])), new MP4Iso.SampleTableBox(new MP4Iso.SampleDescriptionBox([sampleEntry]), new MP4Iso.RawTag('stts', hex('0000000000000000')), new MP4Iso.RawTag('stsc', hex('0000000000000000')), new MP4Iso.RawTag('stsz', hex('000000000000000000000000')), new MP4Iso.RawTag('stco', hex('0000000000000000'))))));
                    }
                    traks.push(trak);
                }
                var mvex = new MP4Iso.MovieExtendsBox(null, [
                    new MP4Iso.TrackExtendsBox(1, 1, 0, 0, 0),
                    new MP4Iso.TrackExtendsBox(2, 1, 0, 0, 0)
                ], null);
                var udat = new MP4Iso.BoxContainerBox('udat', [
                    new MP4Iso.MetaBox(new MP4Iso.RawTag('hdlr', hex('00000000000000006D6469726170706C000000000000000000')), // notice weird stuff in reserved field
                    [new MP4Iso.RawTag('ilst', hex('00000025A9746F6F0000001D6461746100000001000000004C61766635342E36332E313034'))])
                ]);
                var mvhd = new MP4Iso.MovieHeaderBox(1000, 0 /* unknown duration */, this.trackStates.length + 1);
                var moov = new MP4Iso.MovieBox(mvhd, traks, mvex, udat);
                var ftype = new MP4Iso.FileTypeBox('isom', 0x00000200, brands);
                var ftypeSize = ftype.layout(0);
                var moovSize = moov.layout(ftypeSize);
                var header = new Uint8Array(ftypeSize + moovSize);
                ftype.write(header);
                moov.write(header);
                this.oncodecinfo(this.trackStates.map(function (ts) { return ts.mimeTypeCodec; }));
                this.ondata(header);
                this.filePos += header.length;
                this.state = MP4MuxState.MAIN_PACKETS;
            };
            MP4Mux.prototype._chunk = function () {
                var cachedPackets = this.cachedPackets;
                if (SPLIT_AT_KEYFRAMES && this.videoTrackState) {
                    var j = cachedPackets.length - 1;
                    var videoTrackId = this.videoTrackState.trackId;
                    // Finding last video keyframe.
                    while (j > 0 &&
                        (cachedPackets[j].trackId !== videoTrackId || cachedPackets[j].packet.frameType !== VideoFrameType.KEY)) {
                        j--;
                    }
                    if (j > 0) {
                        // We have keyframes and not only the first frame is a keyframe...
                        cachedPackets = cachedPackets.slice(0, j);
                    }
                }
                if (cachedPackets.length === 0) {
                    return; // No data to produce.
                }
                var tdatParts = [];
                var tdatPosition = 0;
                var trafs = [];
                var trafDataStarts = [];
                for (var i = 0; i < this.trackStates.length; i++) {
                    var trackState = this.trackStates[i];
                    var trackInfo = trackState.trackInfo;
                    var trackId = trackState.trackId;
                    // Finding all packets for this track.
                    var trackPackets = cachedPackets.filter(function (cp) { return cp.trackId === trackId; });
                    if (trackPackets.length === 0) {
                        continue;
                    }
                    //var currentTimestamp = (trackPackets[0].timestamp * trackInfo.timescale / 1000) | 0;
                    var tfdt = new MP4Iso.TrackFragmentBaseMediaDecodeTimeBox(trackState.cachedDuration);
                    var tfhd;
                    var trun;
                    var trunSamples;
                    trafDataStarts.push(tdatPosition);
                    switch (trackInfo.codecId) {
                        case AAC_SOUND_CODEC_ID:
                        case MP3_SOUND_CODEC_ID:
                            trunSamples = [];
                            for (var j = 0; j < trackPackets.length; j++) {
                                var audioPacket = trackPackets[j].packet;
                                var audioFrameDuration = Math.round(audioPacket.samples * trackInfo.timescale / trackInfo.samplerate);
                                tdatParts.push(audioPacket.data);
                                tdatPosition += audioPacket.data.length;
                                trunSamples.push({ duration: audioFrameDuration, size: audioPacket.data.length });
                                trackState.samplesProcessed += audioPacket.samples;
                            }
                            var tfhdFlags = MP4Iso.TrackFragmentFlags.DEFAULT_SAMPLE_FLAGS_PRESENT;
                            tfhd = new MP4Iso.TrackFragmentHeaderBox(tfhdFlags, trackId, 0 /* offset */, 0 /* index */, 0 /* duration */, 0 /* size */, MP4Iso.SampleFlags.SAMPLE_DEPENDS_ON_NO_OTHERS);
                            var trunFlags = MP4Iso.TrackRunFlags.DATA_OFFSET_PRESENT |
                                MP4Iso.TrackRunFlags.SAMPLE_DURATION_PRESENT | MP4Iso.TrackRunFlags.SAMPLE_SIZE_PRESENT;
                            trun = new MP4Iso.TrackRunBox(trunFlags, trunSamples, 0 /* data offset */, 0 /* first flags */);
                            trackState.cachedDuration = Math.round(trackState.samplesProcessed * trackInfo.timescale / trackInfo.samplerate);
                            break;
                        case AVC_VIDEO_CODEC_ID:
                        case VP6_VIDEO_CODEC_ID:
                            trunSamples = [];
                            var samplesProcessed = trackState.samplesProcessed;
                            var decodeTime = samplesProcessed * trackInfo.timescale / trackInfo.framerate;
                            var lastTime = Math.round(decodeTime);
                            for (var j = 0; j < trackPackets.length; j++) {
                                var videoPacket = trackPackets[j].packet;
                                samplesProcessed++;
                                var nextTime = Math.round(samplesProcessed * trackInfo.timescale / trackInfo.framerate);
                                var videoFrameDuration = nextTime - lastTime;
                                lastTime = nextTime;
                                var compositionTime = Math.round(samplesProcessed * trackInfo.timescale / trackInfo.framerate +
                                    videoPacket.compositionTime * trackInfo.timescale / 1000);
                                tdatParts.push(videoPacket.data);
                                tdatPosition += videoPacket.data.length;
                                var frameFlags = videoPacket.frameType === VideoFrameType.KEY ?
                                    MP4Iso.SampleFlags.SAMPLE_DEPENDS_ON_NO_OTHERS :
                                    (MP4Iso.SampleFlags.SAMPLE_DEPENDS_ON_OTHER | MP4Iso.SampleFlags.SAMPLE_IS_NOT_SYNC);
                                trunSamples.push({ duration: videoFrameDuration, size: videoPacket.data.length,
                                    flags: frameFlags, compositionTimeOffset: (compositionTime - nextTime) });
                            }
                            var tfhdFlags = MP4Iso.TrackFragmentFlags.DEFAULT_SAMPLE_FLAGS_PRESENT;
                            tfhd = new MP4Iso.TrackFragmentHeaderBox(tfhdFlags, trackId, 0 /* offset */, 0 /* index */, 0 /* duration */, 0 /* size */, MP4Iso.SampleFlags.SAMPLE_DEPENDS_ON_NO_OTHERS);
                            var trunFlags = MP4Iso.TrackRunFlags.DATA_OFFSET_PRESENT |
                                MP4Iso.TrackRunFlags.SAMPLE_DURATION_PRESENT | MP4Iso.TrackRunFlags.SAMPLE_SIZE_PRESENT |
                                MP4Iso.TrackRunFlags.SAMPLE_FLAGS_PRESENT | MP4Iso.TrackRunFlags.SAMPLE_COMPOSITION_TIME_OFFSET;
                            trun = new MP4Iso.TrackRunBox(trunFlags, trunSamples, 0 /* data offset */, 0 /* first flag */);
                            trackState.cachedDuration = lastTime;
                            trackState.samplesProcessed = samplesProcessed;
                            break;
                        default:
                            throw new Error('Un codec');
                    }
                    var traf = new MP4Iso.TrackFragmentBox(tfhd, tfdt, trun);
                    trafs.push(traf);
                }
                this.cachedPackets.splice(0, cachedPackets.length);
                var moofHeader = new MP4Iso.MovieFragmentHeaderBox(++this.chunkIndex);
                var moof = new MP4Iso.MovieFragmentBox(moofHeader, trafs);
                var moofSize = moof.layout(0);
                var mdat = new MP4Iso.MediaDataBox(tdatParts);
                var mdatSize = mdat.layout(moofSize);
                var tdatOffset = moofSize + 8;
                for (var i = 0; i < trafs.length; i++) {
                    trafs[i].run.dataOffset = tdatOffset + trafDataStarts[i];
                }
                var chunk = new Uint8Array(moofSize + mdatSize);
                moof.write(chunk);
                mdat.write(chunk);
                this.ondata(chunk);
                this.filePos += chunk.length;
            };
            return MP4Mux;
        })();
        
        MP4Mux.MP3_SOUND_CODEC_ID = MP3_SOUND_CODEC_ID;
        MP4Mux.AAC_SOUND_CODEC_ID = AAC_SOUND_CODEC_ID;
        MP4Mux.TYPE_AUDIO_PACKET = AUDIO_PACKET;
        MP4Mux.TYPE_VIDEO_PACKET = VIDEO_PACKET;
        
        MP4Mux.Profiles = {
          MP3_AUDIO_ONLY: {
            audioTrackId: 0,
            videoTrackId: -1,
            tracks: [
              {
                codecId: MP4Mux.MP3_SOUND_CODEC_ID,
                channels: 2,
                samplerate: 44100,
                samplesize: 16,
                timescale: 44100,
              },
            ],
          },
        };
        
        return MP4Mux;
    })();

    global.MP3Parser = MP3Parser;
    global.MP4Mux = MP4Mux;
    global.MP4Iso = Iso;
})(window);