(function($SimpleMP3Player){
    var EventDispatcher = function() {
        var ID = 0;
        function EventDispatcher(){
            this._listeners = [];
        }

        EventDispatcher.prototype.getListeners = function() {
            this._listeners = this._listeners.filter(function(subscriber){
                return !subscriber.dead;
            }).sort(function(a, b) {
                return a.priority - b.priority;
            });
            return this._listeners;
        };

        EventDispatcher.prototype.subscribe = function(callback, priority) {
            if(priority === void 0) {
                priority = 20;
            }
            var subscriber = {
                id: ID++,
                handler: callback,
                priority: priority,
                dead: false
            };
            this._listeners.push(subscriber);
            return {
                remove: function() {
                    subscriber.dead = true;
                }
            };
        };

        EventDispatcher.prototype.dispatch = function(payload) {
            var that = this;
            this.getListeners().forEach(function(listener){
                that._handleCallback(listener.handler, payload);
            });
        };

        EventDispatcher.prototype._handleCallback = function(handler, payload) {
            try {
                handler(payload);
            } catch(error) {
                window.setTimeout(function(){
                    throw error;
                }, 0);
            }
        };

        return EventDispatcher;
    }();

    function MP3Muxer(data) {
        var audioBufferArr = [];
        var samplerate = null;
        var mp3Info = {
            rate: samplerate || 44100,
            id: 3
        };

        var n_2 = 2;
        var n_8 = 8;
        var n_16 = 16;
        var trackInfo = null;
        var mp3Parser = new MP3Parser();
        var mp4Mux = null;
        mp3Parser.onFrame = function(data) {
            try {
                if(mp4Mux === null) {
                    samplerate = mp3Parser.samplerate;
                    mp3Info = {
                        rate: samplerate,
                        id: 3
                    };
                    trackInfo = {
                        codecId: n_2,
                        channels: n_2,
                        samplerate: mp3Info.rate,
                        samplesize: n_16,
                        timescale: samplerate
                    };
                    mp4Mux = new MP4Mux({
                        audioTrackId: 0,
                        videoTrackId: -1,
                        tracks: [trackInfo]
                    });
                    mp4Mux.ondata = function(push_data) {
                        audioBufferArr.push(push_data);
                    };
                }
                mp3Parser.onFrame = function(_data) {
                    var buf = new Uint8Array(_data.length + 1);
                    var n_ = n_2 << 4;
                    n_ |= mp3Info.id << 2;
                    n_ |= (16 === n_16 ? 1 : 0) << 1;
                    n_ |= 2 === n_2 ? 1 : 0;
                    buf[0] = n_;
                    buf.set(_data, 1);
                    var i = 0;
                    mp4Mux.pushPacket(n_8, buf, i);
                };
                mp3Parser.onFrame(data);
            } catch(e) {
                console.log(e);
            }
        };
        mp3Parser.push(data);
        mp3Parser.close();
        mp4Mux.flush();
        if(audioBufferArr.length === 0) {
            throw new Error("There was no output.");
        }

        return audioBufferArr;
    }

    function convertURL2URI(url) {
        if(url && url.substring(0, 4) !== 'http' && window.request_uri) {
            url = (window.request_uri + url).replace(/(\/.\/)/gi, '/');
        }

        return url;
    }

    var MemoryCacheManager = function() {
        function MemoryCacheManager(maxCacheSize) {
            if(maxCacheSize === void 0) {
                maxCacheSize = 150000000;
            }
            this._destructed = false;
            this._maxCacheSize = maxCacheSize;
            this._cacheSize = 0;
            this._store = []; // data, start, end, file_srl
        }

        MemoryCacheManager.prototype.getCache = function(file_srl, start, end) {
            var buffer = this._store.find(function(eachCache){
                return eachCache.file_srl === file_srl && eachCache.start === start && eachCache.end === end;
            });
            return buffer ? buffer.data : null;
        };

        MemoryCacheManager.prototype.setCache = function(data, file_srl, start, end) {
            if(!this.getCache(file_srl, start, end)) {
                this._store.push({
                    file_srl: file_srl,
                    start: start,
                    end: end,
                    data: data
                });
                this._cacheSize += data.byteLength;
            }
            if(this.getCacheUsage() > this._maxCacheSize) {
                this.clear(file_srl);
            }
        };

        MemoryCacheManager.prototype.getCacheUsage = function() {
            return this._cacheSize;
        };

        MemoryCacheManager.prototype.updateCacheUsage = function() {
            this._cacheSize = this._store.reduce(function(total, eachCache){
                var size = eachCache && eachCache.data ? eachCache.data.byteLength : 0;
                return total+size;
            }, 0);

            return this._cacheSize;
        };

        MemoryCacheManager.prototype.setMaximumCacheSize = function(maxCacheSize) {
            if(maxCacheSize === void 0) {
                maxCacheSize = 150000000;
            }
            this._maxCacheSize = maxCacheSize;
            if(this.getCacheUsage() > this._maxCacheSize) {
                this.clear();
            }
        };

        MemoryCacheManager.prototype.clear = function(file_srl) {
            var isReset = !file_srl;
            if(file_srl) {
                var filteredCacheUsage = 0;
                this._store = this._store.filter(function(eachCache) {
                    if(eachCache.file_srl === file_srl) {
                        if(eachCache && eachCache.data) {
                            filteredCacheUsage += eachCache.data.byteLength;
                        }
                        return true;
                    }
                    return false;
                });
                if(filteredCacheUsage > this._maxCacheSize) {
                    isReset = true;
                }
            }
            if(isReset) {
                this._cacheSize = 0;
                this._store = [];
            }
            this.updateCacheUsage();
        };

        MemoryCacheManager.prototype.isDestructed = function() {
            return this._destructed;
        };

        MemoryCacheManager.prototype.destruct = function() {
            if(!this.isDestructed()) {
                this._destructed = true;
                this._store = [];
                this._cacheSize = 0;
            }
        };

        return MemoryCacheManager;

    }();

    var always = function(promise) {
        return new Promise(function(resolve) {
            promise.then(function(data){
                resolve(data);
            })['catch'](function(e){
                resolve(e);
            });
        });
    };

    var MSE = function() {

        var MSE_ID = 0;
        var MAX_BUFFER_SIZE = 12;

        var mp3 = "audio/mpeg";
        var mp4inmp3 = 'audio/mp4; codecs="mp3"';
        var mp4audio = "audio/mp4";

        var ua = typeof window.navigator !== "undefined" ? window.navigator.userAgent : "";
        var safari = !/chrome|opera/i.test(ua) && /safari/i.test(ua);
        var msie =  ua.indexOf("Trident/") >= 0 || ua.indexOf("MSIE ") >= 0;
        var ff = ua.toLowerCase().indexOf("firefox") >= 0;
        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

        function getCapableCodec() {
            var codec = ff ? mp4inmp3 : mp3;
            if(safari) {
                codec = mp4audio;
            }

            return codec;
        }

        function getSourceBufferedRanges(sourceBuffer) {
            if(!sourceBuffer) {
                return [];
            }
            var buffered = sourceBuffer.buffered;
            var bufferedLen = buffered.length;
            var timeRanges = [];
            for(var i=0; i<bufferedLen; i++) {
                timeRanges.push({
                    start: buffered.start(i),
                    end: buffered.end(i)
                });
            }

            return timeRanges;
        }

        function normalizeOffsetList(offsets) {
            var duration = 0;
            return offsets.map(function(each){
                var obj = {
                    duration: each.time,
                    startOffset: each.startOffset,
                    endOffset: each.endOffset,
                    url: each.url ? each.url : null,
                    TimeRange: {
                        start: duration,
                        end: duration+each.time
                    }
                };
                duration += each.time;
                return obj;
            })
        }

        var RequestToFetch = function() {

            var REQUESTER_ID = 0;

            function buildResponse(code, data, retryCount, aborted) {
                return {
                    code: code || -1,
                    data: data || null,
                    retryCount: retryCount || 0,
                    aborted: aborted
                }
            }

            function RequestToFetch(url, start, end) {
                if(!this.constructor.isSupported()) {
                    throw new Error('Fetch API does not supported in browser');
                }

                var that = this;
                this._id = REQUESTER_ID++;
                this._url = url;
                this._rangeStart = start;
                this._rangeEnd = end;
                this._AbortController = null;
                this._resolveHandler  = null;
                this._rejectHandler = null;
                this._settled = false;
                this._aborted = false;
                this._response = null;
                this._promise = new window.Promise(function(resolve, reject){
                    that._resolveHandler = resolve;
                    that._rejectHandler = reject;
                });
                this._retryTimerID = null;
                this._retryCount = 0;
                this._fetch = null;
                this._run();
            }

            RequestToFetch.isSupported = function() {
                return 'AbortController' in window && 'fetch' in window && 'Headers' in window;
            };

            RequestToFetch.prototype._run = function() {
                if(!this.isSettled()) {
                    var that = this;
                    this._clearRetryTimerID();
                    this._AbortController = new window.AbortController;
                    var headers = void 0;
                    if(this._rangeStart !== void 0 && this._rangeEnd !== void 0) {
                        headers = new window.Headers;
                        headers.append('Range', 'bytes='+this._rangeStart+'-'+this._rangeEnd);
                    }
                    this._fetch = window.fetch(this._url, {
                        method: 'GET',
                        signal: this._AbortController.signal,
                        credentials: 'omit',
                        headers: headers
                    }).then(function(response){
                        if(that.isAborted()) {
                            return;
                        }
                        if(response.ok) {
                            response.arrayBuffer().then(function(data){
                                that._resolve(buildResponse(response.status, data, that._retryCount, that.isAborted()));
                            })['catch'](function(e){

                            });
                        } else {
                            if(response.status && response.status >=400 && response.status <= 500) {
                                that._reject(buildResponse(response.status, null, that._retryCount, that.isAborted()));
                            } else {
                                that._retryTimerID = window.setTimeout(that._run.bind(that), 1000);
                            }
                        }
                        that._response = response;
                    })['catch'](function(err){
                        if(!that._aborted) {
                            if(that._retryTimerID === null) {
                                that._retryTimerID = window.setTimeout(that._run.bind(that), 1000);
                            }
                        }
                    });
                }
            };

            RequestToFetch.prototype._resolve = function(data) {
                if(!this._settled) {
                    this._resolveHandler(data);
                    this._settled = true;
                }
            };

            RequestToFetch.prototype._reject = function(err) {
                if(!this._settled) {
                    this._rejectHandler(err);
                    this._settled = true;
                }
            };

            RequestToFetch.prototype._clearRetryTimerID = function() {
                if(this._retryTimerID !== null) {
                    window.clearTimeout(this._retryTimerID);
                    this._retryTimerID = null;
                }
            };

            RequestToFetch.prototype.abort = function() {
                if(!this._settled) {
                    this._aborted = true;
                    this._clearRetryTimerID();
                    if(this._AbortController) {
                        this._AbortController.abort();
                    }
                    this._reject(buildResponse(void 0, void 0, void 0, true));
                }
            };

            RequestToFetch.prototype.isSettled = function() {
                return this._settled || this._aborted;
            };

            RequestToFetch.prototype.isAborted = function() {
                return this._aborted;
            };

            RequestToFetch.prototype.getPromise = function() {
                return this._promise;
            };

            return RequestToFetch;

        }();

        function getAudioBuffer(url, start, end) {
            url = convertURL2URI(url);

            function buildResultObj(code, data) {
                return {
                    aborted: aborted,
                    code: code || -1,
                    data: data || null,
                    retryCount: retryCount
                };
            }

            if(RequestToFetch.isSupported()) {
                var requestFetch = new RequestToFetch(url, start, end);
                return {
                    promise: always(requestFetch.getPromise.call(requestFetch)),
                    abort: requestFetch.abort.bind(requestFetch),
                    isSettled: requestFetch.isSettled.bind(requestFetch)
                };
            }

            var retryCount = 0;
            var xhr = null;
            var aborted = false;
            var finish = false;
            var retryTimeID = null;
            var isSettled = function() {
                return aborted || finish;
            }
            var abortFn = function() {
                if(!isSettled()) {
                    aborted = true;
                    if(retryTimeID !== null) {
                        window.clearTimeout(retryTimeID);
                        retryTimeID = null;
                        reject(buildResultObj());
                    }
                    if(xhr && xhr.readyState !== 4) {
                        xhr.abort();
                        xhr = null;
                    }
                }
            };

            var promise = new Promise(function (resolve, reject)  {
                function run() {
                    xhr = new XMLHttpRequest;
                    xhr.open('GET', url, true);
                    if(start !== void 0 && end !== void 0) {
                        xhr.setRequestHeader('Range', 'bytes='+start+'-'+end);
                    }
                    xhr.responseType = "arraybuffer";
                    xhr.send();
                    xhr.addEventListener('readystatechange', function(evt){
                        if(!isSettled()) {
                            if(aborted) {
                                return reject(buildResultObj());
                            }
                            if(xhr.status >= 400 && xhr.status < 500) {
                                finish = true;
                                reject(buildResultObj(xhr.status));
                            } else if(xhr.readyState === XMLHttpRequest.DONE) {
                                if(xhr.status === 200 || xhr.status === 206) {
                                    finish = true;
                                    resolve(buildResultObj(xhr.status, xhr.response));
                                } else {
                                    xhr = null;
                                    retryCount++;
                                    retryTimeID = window.setTimeout(function(){
                                        retryTimeID = null;
                                        run();
                                    }, 1000);
                                }
                            }
                        }
                    }, false);
                }

                run();
            });

            return {
                promise: promise,
                abort: abortFn,
                isSettled: isSettled
            };
        }

        function getCachedAudioBuffer(data) {
            var requestAborted = false;
            return {
                promise: Promise.resolve({
                    aborted: requestAborted,
                    code: 200,
                    data: data,
                    retryCount: 0,
                    cache: true
                }),
                isSettled: function(){
                    return true;
                },
                abort: function() {
                    return requestAborted = true;
                }
            }
        }

        function MSE(audioNode, mp3URL, playlist, file_srl, bufferSize) {
            this._id = MSE_ID++;
            this._audio = audioNode;
            this._file_srl = file_srl;
            this._playlist = playlist;
            this._duration = playlist.duration;
            this._offsets = normalizeOffsetList(this._playlist.offsets);
            this._mp3URL = mp3URL;
            this._MediaSource = new window.MediaSource;
            this._sourceBuffer = null;
            this._url = window.URL.createObjectURL(this._MediaSource);
            this._initialized = false;
            this._desturct = false;
            this._mimeCodec = getCapableCodec();
            this._appendInitBuffer = false;
            this._onAudioSeekingHandler = this._onAudioSeeking.bind(this);
            this._onAudioTimeUpdateHandler = this._onAudioTimeUpdate.bind(this);
            this._onMediaSourceInitHandler = this._onMediaSourceInit.bind(this);
            this._onMediaSourceEndedHandler = this._onMediaSourceEnded.bind(this);
            this._onMediaSourceErrorHandler = this._onMediaSourceError.bind(this);
            this._onSourceBufferUpdateEndHandler = this._onSourceBufferUpdateEnd.bind(this);
            this._onSourceBufferErrorHandler = this._onSourceBufferError.bind(this);
            this._currentPerformJob = null;
            this._CacheManager = null;
            this._bufferSize = bufferSize && typeof bufferSize === 'number' ? bufferSize : MAX_BUFFER_SIZE;
            this._MediaSource.addEventListener("sourceopen", this._onMediaSourceInitHandler, false);
            this._MediaSource.addEventListener("error", this._onMediaSourceErrorHandler, false);
            this._jobQueue = [];
            this._seeking = false;
            this._request = null;
            this._eosSignalled = false;
            this._lastSegmentIndex = -1;
            this._playingObserverTimerID = null;

            this._init();
        }

        MSE.isSupported = function() {
            if('MediaSource' in window) {
                if(safari) {
                    var regexVer = window.navigator.appVersion.match(/version\/([0-9]+)\.([0-9]+)/i);
                    var safariVersion = -1;
                    if(regexVer && regexVer.length >= 3) {
                        var ver = parseInt(regexVer[1], 10);
                        if(!isNaN(ver)) {
                            safariVersion = ver;
                        }
                    }
                    if(safariVersion < 10) {
                        return false;
                    }
                }

                return window.MediaSource.isTypeSupported(getCapableCodec());
            }

            return false;
        };

        MSE.prototype._init = function() {
            this._ensureNotDestructed();
            this._audio.addEventListener('seeking', this._onAudioSeekingHandler, false);
            this._audio.addEventListener('timeupdate', this._onAudioTimeUpdateHandler, false);
            this._audio.src = this.getURL();
            this._audio.load();
            if(this._bufferSize > 180) {
                this._bufferSize = 180;
            }
            if(this._bufferSize < 1) {
                this._bufferSize = MAX_BUFFER_SIZE;
            }
        };

        MSE.prototype._ensureNotDestructed = function() {
            if(this.isDestructed()) {
                throw new Error("MSE was destructed.");
            }
        };

        MSE.prototype.getCurrentBufferTimeRange = function(position) {
            var timeRanges = getSourceBufferedRanges(this._sourceBuffer);
            return this._sourceBuffer && timeRanges ? (timeRanges.find(function(ranges){
                return position>=ranges.start && position < ranges.end;
            }) || null) : null;
        };

        MSE.prototype._getLeftBuffer = function(currentPosition) {
            var leftBuffer = 0;
            if(!this.isDestructed() && this._sourceBuffer) {
                var endOffset = null;
                var currentTimeRange = this.getCurrentBufferTimeRange(currentPosition);
                if(currentTimeRange) {
                    endOffset = currentTimeRange.end;
                    leftBuffer = endOffset-currentPosition;
                }
                this._jobQueue.forEach(function(job){
                    if(job.type === 'append') {
                        leftBuffer += job.duration;
                    }
                });
                if(this._currentPerformJob && this._currentPerformJob.type === 'append') {
                    leftBuffer += this._currentPerformJob.duration;
                }
                if(leftBuffer > 0) {
                    return leftBuffer;
                } else if(currentTimeRange === null) {
                    return null;
                }
            }

            return leftBuffer;
        };

        MSE.prototype._isRequireMoreBuffer = function() {
            if(!this.isDestructed()) {
                var currentTime = this._audio.currentTime || 0;
                var leftBuffer = this._getLeftBuffer(currentTime);
                if(leftBuffer !== null) {
                    return leftBuffer < this._bufferSize;
                }
                return true;

            }

            return false;
        };

        MSE.prototype.getSegmentOffset = function(position) {
            if(!position) {
                position = 0;
            }
            var lastIndex = -1;
            var offset = this._offsets.find(function(each, idx){
                var timeRange = each.TimeRange;
                lastIndex = idx;
                return position >= timeRange.start && position <=timeRange.end;
            }) || null;

            return {
                index: offset ? lastIndex : -1,
                offset: offset
            };
        };

        MSE.prototype.getDurationFromOffsets = function() {
            var duration = null;
            if(this._offsets && this._offsets.length > 0) {
                var offset = this._offsets[this._offsets.length-1];
                var timeRange = offset.TimeRange;
                duration = timeRange.end;
            }

            return duration;
        };

        MSE.prototype.getFormerBufferDuration = function(position) {
            if(!position) {
                position = 0;
            }
            var formerBuffer = {
                duration:0,
                start: 0,
                end: 0
            };
            if(!this.isDestructed() && this._sourceBuffer) {
                var currentTimeRange = this.getCurrentBufferTimeRange(position);
                if(currentTimeRange) {
                    formerBuffer.duration = position-currentTimeRange.start;
                    formerBuffer.start = currentTimeRange.start;
                    formerBuffer.end = currentTimeRange.end;
                }
            }

            return formerBuffer;
        };

        MSE.prototype.getSegmentIndex = function(idx) {
            return this._offsets[idx];
        };

        MSE.prototype._onAudioSeeking = function() {
            var that = this;
            this._seeking = true;
            this._userInteraction = true;
            if(this._playingObserverTimerID !== null) {
                window.clearTimeout(this._playingObserverTimerID);
            }
            this._playingObserverTimerID = window.setTimeout(function(){
                that._seeking = false;
                that._playingObserverTimerID = null;
                that.seekResetAction();
            }, 30);
        };

        MSE.prototype._onAudioTimeUpdate = function() {
            this.performNextAction();
        };

        MSE.prototype._onBufferRetreived = function(result, offsetData) {
            if(result.aborted) {
                return;
            }
            this._request = null;
            if(result.code >= 400 && result.code < 500) {
                return this.destruct();
            }
            if(result.data) {
                var timeRange = offsetData.TimeRange;
                var start = timeRange.start;
                var end = timeRange.end;
                var duration = end-start;
                var buffer = new Uint8Array(result.data);
                if(this._mimeCodec !== mp3) {
                    var mux = MP3Muxer(buffer);
                    var muxedBuffer = mux[1];
                    if(!this._appendInitBuffer) {
                        this._appendInitBuffer = true;
                        muxedBuffer = new Uint8Array(mux[0].length + mux[1].length);
                        muxedBuffer.set(mux[0], 0);
                        muxedBuffer.set(mux[1], mux[0].length);
                    }
                    this.appendBuffer(muxedBuffer, duration, start, end);
                } else {
                    this.appendBuffer(buffer, duration, start, end);
                }
            }

            this.performNextAction();
        };

        MSE.prototype._onMediaSourceInit = function(evt) {
            this._initialized = true;
            this._MediaSource.duration = this._duration || Infinity;
            this._MediaSource.removeEventListener("sourceopen", this._onMediaSourceInitHandler, false);
            this._MediaSource.removeEventListener("sourceended", this._onMediaSourceInitHandler, false);
            this._sourceBuffer = this._addSourceBuffer(this._mimeCodec);
            this._sourceBuffer.addEventListener('updateend', this._onSourceBufferUpdateEndHandler, false);
            this._sourceBuffer.addEventListener('error', this._onSourceBufferErrorHandler, false);
            this.performNextAction();
        };

        MSE.prototype._onMediaSourceEnded = function(evt) {

        };

        MSE.prototype._onMediaSourceError = function(evt) {
            console.error(evt);
        };

        MSE.prototype._onSourceBufferUpdateEnd = function() {
            this._currentPerformJob = null;
            this.performNextAction();
        };

        MSE.prototype._onSourceBufferError = function(err) {
            console.error(err);
        };

        MSE.prototype.isDestructed = function() {
            return this._desturct;
        };

        MSE.prototype.isUpdating = function() {
            return this._sourceBuffer && this._sourceBuffer.updating;
        };

        MSE.prototype.isEOSSignalled = function() {
            return this._eosSignalled;
        }

        MSE.prototype.provideCacheManager = function(cacheManager) {
            if(cacheManager) {
                this._CacheManager = cacheManager;
            }
        };

        MSE.prototype.seekResetAction = function() {
            if(!this._audio && this.isDestructed()) {
                return;
            }
            var timeRanges = getSourceBufferedRanges(this._sourceBuffer);
            var position = !isNaN(this._audio.currentTime) && this._audio.currentTime ? this._audio.currentTime : 0;
            var bufferTimeRange = this.getCurrentBufferTimeRange(position);
            if(timeRanges.length === 1 && bufferTimeRange) {
                this.performNextAction();
                return;
            }

            var that = this;
            this.abort();
            if(this._request && !this._request.isSettled()) {
                this._request.abort();
                this._request = null;
            }
            this._eosSignalled = false;
            if(this._sourceBuffer) {
                timeRanges.forEach(function(eachRange){
                    that.removeBuffer(eachRange.start, eachRange.end);
                });
            }
            var segmentOffset = this.getSegmentOffset(this._audio.currentTime);
            var offsetData = segmentOffset.offset;
            this._lastSegmentIndex = segmentOffset.index;
            if(this._lastSegmentIndex === -1) {
                if(this._audio && !isNaN(this._audio.currentTime) && this._audio.currentTime) {
                    var duration = this.getDurationFromOffsets();
                    if(duration) {
                        this._audio.currentTime = duration - 0.2;
                    }
                } else {
                    window.setTimeout(function(){
                        throw new Error('Current playback head outside of buffer in append-continue state.');
                    }, 0);
                }

                return;
            }
            this._lastSegmentIndex--;
            this.setTimestampOffset(offsetData.TimeRange.start);
            this.performNextAction();
        };

        MSE.prototype.performNextAction = function() {
            this._ensureNotDestructed();
            if(this._sourceBuffer && !this._seeking && !this.isEOSSignalled()) {
                var that = this;
                var formerDuration = this.getFormerBufferDuration(this._audio.currentTime);
                if(formerDuration.duration > 6) {
                    this.removeBuffer(formerDuration.start, formerDuration.start+formerDuration.duration-1);
                }
                if(this._request === null && this._isRequireMoreBuffer()) {
                    this._lastSegmentIndex++;
                    if(this._lastSegmentIndex < this._offsets.length) {
                        var idxData = this.getSegmentIndex(this._lastSegmentIndex);
                        var cachedData = this.getCache(idxData.startOffset, idxData.endOffset);
                        if(cachedData) {
                            this._request = getCachedAudioBuffer(cachedData);
                        } else {
                            this._request = idxData.url ? getAudioBuffer(idxData.url) :  getAudioBuffer(this._mp3URL, idxData.startOffset, idxData.endOffset);
                        }

                        var requestPromise = this._request.promise;
                        requestPromise.then(function(result) {
                            if(result && (result.code === 200 || result.code === 206)) {
                                that.setCache(result.data, idxData.startOffset, idxData.endOffset);
                            }
                            that._onBufferRetreived(result, idxData);
                        })['catch'](function(e){
                            console.error(e, idxData);
                            that._onBufferRetreived(e, idxData);
                        });
                    } else if (this._lastSegmentIndex >= this._offsets.length) {
                        return this.signalEOS();
                    }
                }
            }

            this.performNextQueueAction();
        };

        MSE.prototype.getCache = function(start, end) {
            if(this._CacheManager) {
                return this._CacheManager.getCache(this._file_srl, start, end);
            }

            return null;
        };

        MSE.prototype.setCache = function(data, start, end) {
            if(this._CacheManager) {
                return this._CacheManager.setCache(data, this._file_srl, start, end);
            }
        };

        MSE.prototype.performNextQueueAction = function() {
            if(this.isUpdating() || this.isDestructed()) {
                return;
            }
            if(this._sourceBuffer && this._jobQueue.length > 0) {
                var sourceBuffer = this._sourceBuffer;
                var job = this._jobQueue.shift();
                var type = job.type;
                this._currentPerformJob = job;
                switch(type) {
                    case 'remove':
                        sourceBuffer.remove(job.start, job.end);
                        break;

                    case 'append':
                        sourceBuffer.appendBuffer(job.data);
                        break;

                    case 'timestampOffset':
                        sourceBuffer.timestampOffset = job.offset;
                        this.performNextAction();
                        break;

                    case 'eos':
                        this._MediaSource.endOfStream();
                        break;
                }
            }
        };

        MSE.prototype._revokeURL = function() {
            if(this._url) {
                window.URL.revokeObjectURL(this._url);
                this._url = null;
            }
        };

        MSE.prototype._addSourceBuffer = function(mimeCodec) {
            this._ensureNotDestructed();
            var sourceBuffer = this._MediaSource.addSourceBuffer(mimeCodec || this._mimeCodec);
            sourceBuffer.mode = "sequence";
            //this.performNextAction();

            return sourceBuffer;
        };

        MSE.prototype._removeSourceBuffer = function() {
            if(this._sourceBuffer) {
                this._sourceBuffer.removeEventListener('updateend', this._onSourceBufferUpdateEndHandler, false);
                this._sourceBuffer.removeEventListener('error', this._onSourceBufferErrorHandler, false);
                this._MediaSource.removeSourceBuffer(this._sourceBuffer);
                this._sourceBuffer = null;
            }
        };

        MSE.prototype.removeBuffer = function(start, end) {
            this._ensureNotDestructed();
            this._jobQueue.push({
                type: 'remove',
                start: start,
                end: end
            });
            this.performNextQueueAction();
        };

        MSE.prototype.appendBuffer = function(data, duration, start, end) {
            this._ensureNotDestructed();
            this._jobQueue.push({
                type: 'append',
                start: start,
                end: end || start+duration,
                duration: duration,
                data: data
            });

            this.performNextQueueAction();
        };

        MSE.prototype.setTimestampOffset = function(offset) {
            this._ensureNotDestructed();
            this._jobQueue.push({
                type: 'timestampOffset',
                offset: offset
            });

            this.performNextQueueAction();
        };

        MSE.prototype.signalEOS = function() {
            this._ensureNotDestructed();
            this._eosSignalled = true;
            this._jobQueue.push({
                type: 'eos'
            });
            this.performNextQueueAction();
        };

        MSE.prototype.abort = function() {
            this._jobQueue = [];
            this._currentPerformJob = null;
            if(this._sourceBuffer && this._sourceBuffer.updating) {
                this._sourceBuffer.abort();
            }
        };

        MSE.prototype.getURL = function() {
            return this._url;
        };

        MSE.prototype.destruct = function() {
            if(!this._desturct) {
                this.abort();
                this._desturct = true;
                if(this._request && !this._request.isSettled()) {
                    this._request.abort();
                }
                this._audio.removeEventListener('seeking', this._onAudioSeekingHandler, false);
                this._audio.removeEventListener('timeupdate', this._onAudioTimeUpdateHandler, false);
                if(!this._initialized) {
                    this._MediaSource.removeEventListener('sourceopen', this._onMediaSourceInitHandler, false);
                }
                this._MediaSource.removeEventListener('sourceended', this._onMediaSourceEndedHandler, false);
                this._MediaSource.removeEventListener("error", this._onMediaSourceErrorHandler, false);
                this._removeSourceBuffer();
                this._audio.src = '';
                this._audio.load();
                this._revokeURL();
                this._audio = null;
                this._CacheManager = null;
            }
        };

        return MSE;
    }();

    var __extend = function() {
        var setProperty = Object.setPrototypeOf || {
                __proto__: []
            } instanceof Array && function(subClass, superClass) {
                subClass.__proto__ = superClass;
            }
            || function(subClass, superClass) {
                for (var key in superClass) {
                    superClass.hasOwnProperty(key) && (subClass[key] = superClass[key]);
                }
            };

        return function(subClass, superClass) {
            function fn() {
                this.constructor = subClass;
            }

            setProperty(subClass, superClass);
            if(superClass === null) {
                subClass.prototype = Object.create(superClass);
            } else {
                fn.prototype = superClass.prototype;
                subClass.prototype = new fn;
            }
        };
    }();

    var PlayerObserver = function() {
        function PlayerObserver(player) {
            this.onPlaying = new EventDispatcher;
            this._player = player;
            this._onAudioPlayingHandler = null;
        }

        PlayerObserver.prototype.getAutoplayPriority = function() {
            return 100;
        };

        PlayerObserver.prototype.onAudioPlaying = function() {
            this.onPlaying.dispatch(this);
        };

        PlayerObserver.prototype.isPlaying = function() {
            return null;
        };

        PlayerObserver.prototype.getType = function() {
            return "DEFAULT_PLAYER";
        };

        PlayerObserver.prototype.play = function() {
            return null;
        };

        PlayerObserver.prototype.pause = function() {
            return null;
        };

        return PlayerObserver;
    }();

    var HTML5PlayerObserver = function() {
        function HTML5PlayerObserver(player) {
            var that = PlayerObserver.call(this, player) || this;
            that._autoplayFlag = false;
            that._onLoadedDataHandler = that._onLoadedData.bind(that);
            that._onAudioPlayingHandler = that.onAudioPlaying.bind(that);
            player.addEventListener('loadeddata', that._onLoadedDataHandler, false);
            player.addEventListener('playing', that._onAudioPlayingHandler, false);
        }

        __extend(HTML5PlayerObserver, PlayerObserver);

        HTML5PlayerObserver.prototype._onLoadedData = function() {
            this._player.removeEventListener('loadeddata', this._onLoadedDataHandler, false);
            if(this._autoplayFlag && !this.isPlaying()) {
                var that = this;
                var promise = this._player.play();
                if(promise) {
                    promise.then(function(){
                        that._autoplayFlag = false;
                    })['catch'](function(e){
                        that._autoplayFlag = false;
                        console.error(e);
                    });
                } else {
                    this._autoplayFlag = false;
                }
            }
        };

        HTML5PlayerObserver.prototype.getAutoplayPriority = function() {
            return 90;
        };

        HTML5PlayerObserver.prototype.isPlaying = function() {
            return this._player ? !this._player.paused : false;
        };

        HTML5PlayerObserver.prototype.getType = function() {
            return "HTML5_PLAYER";
        };

        HTML5PlayerObserver.prototype.play = function(init) {
            if(this._player && this._player.duration && this._player.paused) {
                return this._player.play();
            } else if(init) {
                return this._autoplayFlag = true;
            }

            return false;
        };

        HTML5PlayerObserver.prototype.pause = function() {
            this._autoplayFlag = false;
            if(this.isPlaying()) {
                this._player.pause();
            }
        };

        return HTML5PlayerObserver;
    }();

    var SimplePlayerObserver = function() {
        function SimplePlayerObserver(simplePlayer) {
            var player = simplePlayer._audio;
            var that = HTML5PlayerObserver.call(this, player) || this;
            that._SimplePlayer = simplePlayer;
        }

        __extend(SimplePlayerObserver, HTML5PlayerObserver);

        SimplePlayerObserver.prototype.getAutoplayPriority = function() {
            return 85;
        };

        SimplePlayerObserver.prototype.getType = function() {
            return "SIMPLE_PLAYER";
        };

        return SimplePlayerObserver;
    }();

    var APlayerObserver = function() {
        function APlayerObserver(APlayer) {
            var player = APlayer.audio;
            var that = HTML5PlayerObserver.call(this, player) || this;
            that._APlayer = APlayer;
        }

        __extend(APlayerObserver, HTML5PlayerObserver);

        APlayerObserver.prototype.getAutoplayPriority = function() {
            return 80;
        };

        APlayerObserver.prototype.getType = function() {
            return "A_PLAYER";
        };

        return APlayerObserver;
    }();

    var BluePlayerObserver = function() {
        function BluePlayerObserver(bluePlayer) {
            var tools = bluePlayer.constructor.Tools;
            var makeDeferred = tools.makeDeferred;
            var that = PlayerObserver.call(this, bluePlayer) || this;

            that.makeDeferred = makeDeferred;
            that._initializingDeferred = makeDeferred();
            that._initializingPromise = that._initializingDeferred.promise;
            that._playingDeferred = null;
            that._isInitialized = false;
            that._occurredError = false;
            that._onAudioPlayingHandler = this.onAudioPlaying.bind(this);
            that._onAudioPlayingSubscriber = null;
            that._init();
        }

        __extend(BluePlayerObserver, PlayerObserver);

        BluePlayerObserver.prototype._init = function() {
            var that = this;
            var player = this._player;
            if(player.isInitialized()) {
                this._initializingDeferred.resolve();
            } else {
                this._player.getInitializingPromise().then(function(){
                    var playback = player._Playback;
                    that._isInitialized = true;
                    that._onAudioPlayingSubscriber = playback.onPlaying.subscribe(that._onAudioPlayingHandler);
                    that._initializingDeferred.resolve();
                })['catch'](function(e){
                    that._initializingDeferred.reject(e);
                    that._occurredError = true;
                    console.error(e);
                });
            }
        };

        BluePlayerObserver.prototype.getAutoplayPriority = function() {
            return 80;
        };

        BluePlayerObserver.prototype.isPlaying = function() {
            if(this._isInitialized) {
                var player = this._player;
                var playback = player._Playback;

                return playback.isPlaying();
            }
            return false;
        };

        BluePlayerObserver.prototype.play = function() {
            var that = this;
            var onInitialized = function() {
                var player = that._player;
                player.play();
            };
            if(!this._occurredError) {
                if(this._isInitialized) {
                    onInitialized();
                } else {
                    this._playingDeferred = this.makeDeferred();
                    this._initializingPromise.then(function(){
                        onInitialized();
                        that._playingDeferred.resolve();
                    })['catch'](function(e){
                        that._playingDeferred.reject(e);
                    });
                }
            }
        };

        BluePlayerObserver.prototype.pause = function() {
            if(this._playingDeferred && !this._playingDeferred.isResolved()) {
                this._playingDeferred.reject({
                    type: 'paused',
                    error: null
                });
                this._playingDeferred = null;
            }
            if(this._isInitialized) {
                var player = this._player;
                try{
                    player.pause();
                } catch(e) {

                }
            }
        };

        BluePlayerObserver.prototype.getType = function() {
            return "BLUE_PLAYER";
        };

        return BluePlayerObserver;

    }();

    var SimpleVideoPlayerObserver = function() {
        function SimpleVideoPlayerObserver(player) {
            var playerNode = player.getVideoNode();
            var that = PlayerObserver.call(this, playerNode) || this;
            that._autoplayFlag = false;
            that._onLoadedDataHandler = that._onLoadedData.bind(that);
            that._onVideoPlayingHandler = that.onAudioPlaying.bind(that);
            playerNode.addEventListener('loadeddata', that._onLoadedDataHandler, false);
            playerNode.addEventListener('playing', that._onVideoPlayingHandler, false);
        }

        __extend(SimpleVideoPlayerObserver, HTML5PlayerObserver);

        SimpleVideoPlayerObserver.prototype.getAutoplayPriority = function() {
            return 80;
        };

        return SimpleVideoPlayerObserver;

    }();

    var PlayerManager = function() {
        function PlayerManager() {
            this._listeners = [];
            this._observers = [];
            this._currentPlayer = null;
        }

        PlayerManager.prototype.findObserver = function(playerObserver) {
            return this._observers.find(function(each){
                return each === playerObserver;
            }) || null;
        };

        PlayerManager.prototype.registerPlayer = function(playerObserver) {
            if(playerObserver && !this.findObserver(playerObserver)) {
                var that = this;
                var listener = playerObserver.onPlaying.subscribe(function(){
                    that._onPlaying(playerObserver);
                });
                this._observers.push(playerObserver);
                this._listeners.push(listener);
            }
        };

        PlayerManager.prototype._onPlaying = function(playerObserver) {
            if(this._currentPlayer && this._currentPlayer !== playerObserver && this._currentPlayer.isPlaying()) {
                this._currentPlayer.pause();
            }

            this._currentPlayer = playerObserver;
        };

        PlayerManager.prototype.performAutoplay = function() {
            var autoplayTarget = this._observers.reduce(function(target, current){
                if(target === null) {
                    return current;
                }

                return current.getAutoplayPriority() < target.getAutoplayPriority() ? current : target;
            }, null);
            if(autoplayTarget) {
                autoplayTarget.play(true);
                this._currentPlayer = autoplayTarget;
            }
        };

        return PlayerManager;
    }();

    function getMP3Description(document_srl, file_srl) {
        if(!document_srl || !file_srl || window.default_url === void 0) {
            return Promise.reject(void 0);
        }

        return new Promise(function(resolve, reject){
            var xhr = new XMLHttpRequest;
            var url = window.request_uri+'index.php?act=getSimpleMP3Description&document_srl='+document_srl+"&file_srl="+file_srl;
            xhr.open('GET', url, true);
            xhr.send();
            xhr.addEventListener('load', function(){
                var data = xhr.response;
                if (xhr.status != 200) {
                    reject(xhr.status);
                } else {
                    try {
                        var result = JSON.parse(data);
                        resolve(result);
                    } catch(e){
                        reject(e);
                    }
                }
            }, false);
        });
    }

    function getMP3Descriptions(document_srl) {
        if(!document_srl || window.default_url === void 0) {
            return Promise.reject(void 0);
        }

        return new Promise(function(resolve, reject){
            var xhr = new XMLHttpRequest;
            var url = window.request_uri+'index.php?act=getSimpleMP3Descriptions&document_srl='+document_srl;
            xhr.open('GET', url, true);
            xhr.send();
            xhr.addEventListener('load', function(){
                var data = xhr.response;
                if (xhr.status != 200) {
                    reject(xhr.status);
                } else {
                    try {
                        var result = JSON.parse(data);
                        resolve(result);
                    } catch(e){
                        reject(e);
                    }
                }
            }, false);
        });
    }

    var document_srl = null;

    var onAudioDescriptionLoad = new EventDispatcher;
    var onVideoDescriptionLoad = new EventDispatcher;

    function ampToAmp(str) {
        if(str) {
            return str.replace(/(\&amp\;)/gi, '&');
        }

        return str;
    }

    function removeExtension(filename) {
        return typeof filename === 'string' ? filename.replace(/\.[^/.]+$/, "") : filename;
    }

    function descriptionDecorator(descriptions) {

        function base64DecodeUnicode(str) {
            var decodedData;
            try {
                decodedData = str ? atob(str) : str;
            } catch(e){
                console.error(e);
                return null;
            }

            return decodedData ? window.decodeURIComponent(Array.prototype.map.call(decodedData, function(char){
                return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2);
            }).join('')) : null;
        }

        var decodeFrameData = function(frame) {
            if(frame) {
                try {
                    if(frame.ownerID) {
                        frame.ownerID = window.atob(frame.ownerID);
                    }
                    if(frame.data) {
                        frame.data = window.atob(frame.data);
                    }
                    if(frame.description) {
                        frame.description = window.atob(frame.description);
                    }
                } catch(e){

                }
            }
        };

        var defaultCover = null;
        var removeExtensionInTitle = false;

        if($SimpleMP3Player.config) {
            var config = $SimpleMP3Player.config;
            defaultCover = config.default_cover;
            removeExtensionInTitle = config.remove_extension_in_title;
        }
        if(descriptions) {
            var useThumbnail = config.use_thumbnail;
            var utf8Tag = ['title', 'artist', 'album' ,'albumartist', 'contentgroup', 'genre', 'publisher', 'conductor', 'composer', 'copyright', 'comment', 'www', 'unsyncedlyrics'];
            var exceptedTagKeys = ['priv', 'comm', 'uniquefileid', 'albumArt'];
            descriptions.forEach(function(each){
                var description = each.description;
                if(description) {
                    if(!description.tags) {
                        description.tags = {
                            title: null,
                            artist: null,
                            album: null,
                            albumArt: null
                        };
                    }
                    var tags = description.tags;
                    if(tags.title) {
                        tags.title = ampToAmp(tags.title);
                    }
                    if(tags.artist) {
                        tags.artist = ampToAmp(tags.artist);
                    }
                    if(tags.album) {
                        tags.album = ampToAmp(tags.album);
                    }
                    if(description.download_url) {
                        description.download_url = window.default_url + "index.php" + ampToAmp(description.download_url);
                    }
                    if(tags.priv && tags.priv.length > 0) {
                        tags.priv.forEach(decodeFrameData);
                    }
                    if(tags.uniquefileid) {
                        decodeFrameData(tags.uniquefileid);
                    }
                    if(tags.comm) {
                        tags.comm.forEach(decodeFrameData);
                    }
                    if(removeExtensionInTitle) {
                        description.filename = removeExtension(description.filename);
                    }
                    var stream = description.stream;
                    if(stream) {
                        var audio = stream.audio;
                        var video = stream.video;
                        if(audio && audio.length) {
                            audio.forEach(function(each){
                                if(each) {
                                    Object.keys(each).forEach(function(key){
                                        var valueType = typeof each[key];
                                        if(!(valueType === 'boolean' || valueType === 'number') && each[key] !== null) {
                                            each[key] = window.atob(each[key]);
                                        }
                                    });
                                }
                            });
                        }
                        if(video) {
                            Object.keys(video).forEach(function(key){
                                var valueType = typeof video[key];
                                if(!(valueType === 'boolean' || valueType === 'number') && video[key] !== null) {
                                    video[key] = window.atob(video[key]);
                                }
                            });
                        }
                    }
                    Object.keys(tags).forEach(function(eachKey){
                        if(exceptedTagKeys.indexOf(eachKey) === -1) {
                            var keyType = typeof tags[eachKey];
                            if(!(keyType === 'boolean' || keyType === 'number') && tags[eachKey] !== null) {
                                tags[eachKey] = utf8Tag.indexOf(eachKey) > -1 ? base64DecodeUnicode(tags[eachKey]) : window.atob(tags[eachKey]);
                            }
                        }
                    });
                }
            });
        }
    }


    document.addEventListener("DOMContentLoaded", function(event) {
        var document_srl_regex = /document_(\d+)/.exec(jQuery('.xe_content[class*=document_]').attr('class') || '');
        document_srl = document_srl_regex ? document_srl_regex[1] : null;
        if(document_srl) {
            $SimpleMP3Player.document_srl = parseInt(document_srl, 10);
            getMP3Descriptions(document_srl).then(function(data) {
                $SimpleMP3Player.isDescriptionLoaded = true;
                if(data && data.message === 'success' && data.descriptions) {
                    var config = data.config;
                    var maxMemoryCacheSize = config.mp3_realtime_buffer_cache_size;
                    $SimpleMP3Player.config = config;
                    $SimpleMP3Player.descriptions = data.descriptions;
                    descriptionDecorator(data.descriptions);
                    var filterEmptyDescription = data.descriptions ? data.descriptions.filter(function(each) {
                        return !!(each && each.description);
                    }) : null;
                    var audioDescriptions = [];
                    var videoDescriptions = [];
                    filterEmptyDescription.forEach(function(each){
                        var description = each.description;
                        if(description) {
                            var stream = description.stream;
                            if(stream && stream.duration) {
                                var target = stream.isVideo ? videoDescriptions : audioDescriptions;
                                target.push(each);
                            }
                        }
                    });
                    $SimpleMP3Player.audioDescriptions = audioDescriptions;
                    $SimpleMP3Player.videoDescriptions = videoDescriptions;
                    onAudioDescriptionLoad.dispatch(audioDescriptions);
                    onVideoDescriptionLoad.dispatch(videoDescriptions);
                    if(config && config.allow_autoplay && $SimpleMP3Player.PlayerManager) {
                        $SimpleMP3Player.PlayerManager.performAutoplay();
                    }
                    if($SimpleMP3Player.MemoryCacheManager) {
                        $SimpleMP3Player.MemoryCacheManager.setMaximumCacheSize(maxMemoryCacheSize);
                    }
                }
            })['catch'](function(e){
                $SimpleMP3Player.isDescriptionLoaded = true;
                $SimpleMP3Player.descriptionLoadError.push(e);
            });
        }
    });

    $SimpleMP3Player.document_srl = document_srl;
    $SimpleMP3Player.config = {};
    $SimpleMP3Player.convertURL2URI = convertURL2URI;
    $SimpleMP3Player.PlayerManager = new PlayerManager;
    $SimpleMP3Player.PlayerObserver = {
        HTML5PlayerObserver: HTML5PlayerObserver,
        APlayerObserver: APlayerObserver,
        SimplePlayerObserver: SimplePlayerObserver,
        BluePlayerObserver: BluePlayerObserver,
        SimpleVideoPlayerObserver: SimpleVideoPlayerObserver
    };
    $SimpleMP3Player.descriptionLoadError = [];
    $SimpleMP3Player.descriptions = [];
    $SimpleMP3Player.audioDescriptions = null;
    $SimpleMP3Player.videoDescriptions = null;
    $SimpleMP3Player.isDescriptionLoaded = false;
    $SimpleMP3Player.onAudioDescriptionLoad = onAudioDescriptionLoad;
    $SimpleMP3Player.onVideoDescriptionLoad = onVideoDescriptionLoad;
    $SimpleMP3Player.getMP3Description = getMP3Description;
    $SimpleMP3Player.MemoryCacheManager = new MemoryCacheManager;
    $SimpleMP3Player.descriptionDecorator = descriptionDecorator;
    $SimpleMP3Player.EventDispatcher = EventDispatcher;
    $SimpleMP3Player.MP3Muxer = MP3Muxer;
    $SimpleMP3Player.MSE = MSE;

})(window.$SimpleMP3Player || (window.$SimpleMP3Player = {}));
