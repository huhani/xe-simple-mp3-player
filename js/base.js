(function($SimpleMP3Player){

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

    var makeDeferred = function() {
        var __resolve, __reject;
        var ended = false;
        var promise = new Promise(function(resolve, reject){
            __resolve = resolve;
            __reject = reject;
        });

        return {
            promise: promise,
            resolve: function(data) {
                if(!ended) {
                    __resolve(data);
                    ended = true;
                }
            },
            reject: function(e) {
                if(!ended) {
                    __reject(e);
                    ended = true;
                }
            },
            isEnded: function() {
                return ended;
            }
        };
    };

    var always = function(promise) {
        return new Promise(function(resolve) {
            promise.then(function(data){
                resolve(data);
            })['catch'](function(e){
                resolve(e);
            });
        });
    };

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

    function convertURL2URI(url) {
        if(url && url.substring(0, 4) !== 'http' && window.request_uri) {
            url = (window.request_uri + url).replace(/(\/.\/)/gi, '/');
        }

        return url;
    }

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
            var lastKey = null;
            return offsets.map(function(each){
                if(each.key) {
                    lastKey = each.key;
                }
                var obj = {
                    duration: each.time,
                    startOffset: each.startOffset,
                    endOffset: each.endOffset,
                    url: each.url ? each.url : null,
                    key: lastKey,
                    iv: each.iv ? each.iv : null,
                    TimeRange: {
                        start: duration,
                        end: duration+each.time
                    }
                };
                duration += each.time;
                return obj;
            })
        }

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
                        /**
                         * @nocollapse
                         */
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
                        /**
                         * @nocollapse
                         */
                        mp4Mux.ondata = function(push_data) {
                            audioBufferArr.push(push_data);
                        };
                    }
                    /**
                     * @nocollapse
                     */
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

        function getID3v2TagLength(block) {
            if(String.fromCharCode.apply(null, block.slice(0, 3)) === 'ID3') {
                var id3v2Flag = block[5];
                var flagFooterPresent = id3v2Flag & 0x10 ? 1 : 0;
                var z0 = block[6];
                var z1 = block[7];
                var z2 = block[8];
                var z3 = block[9];
                if((z0 & 0x80) === 0 && (z1 & 0x80) === 0 && (z2 & 0x80)=== 0 && (z3 & 0x80)=== 0) {
                    var headerSize = 10;
                    var tagSize = ((z0&0x7f) * 0x200000) + ((z1&0x7f) * 0x4000) + ((z2&0x7f) * 0x80) + (z3&0x7f);
                    var footerSize = flagFooterPresent ? 10 : 0;

                    return headerSize + tagSize + footerSize;
                }
            }

            return 0;
        }

        function removdID3Tag(data) {
            var tagSize = getID3v2TagLength(data);
            return data.slice(tagSize);
        }

        var AESDecrypter = function() {

            var AbortError = new Error('Decrypting Aborted');
            var NotDecryptedError = new Error('could not read encrypted data');

            var AESDecryptJob = function() {
                function AESDecryptJob(cipher, iv, key) {
                    this.cipher = cipher;
                    this.iv = iv;
                    this.key = key;
                    this._finish = false;
                    this._worker = null;
                    this._workerRunning = false;
                    this._aborted = false;
                    this._deferred = makeDeferred();
                    this._promise = this._deferred.promise;
                    this.onAbort = new EventDispatcher;
                    this.onFinish = new EventDispatcher;
                    this.onDecryptStart = new EventDispatcher;
                    this.onDecryptEnded = new EventDispatcher;
                    this._onMessageHandler = this._onMessage.bind(this);
                    this._onErrorHandler = this._onError.bind(this);
                    this._workerTerminated = false;
                }

                AESDecryptJob.prototype._onMessage = function(evt) {
                    if(!this._finish) {
                        var data = evt.data;
                        if(data && data.buffer instanceof ArrayBuffer && data.byteLength !== undefined) {
                            this._onFinish(data);
                        } else {
                            this._onError(NotDecryptedError);
                        }
                    }
                };

                AESDecryptJob.prototype._onError = function(e) {
                    if(!this._finish) {
                        if(!this.isAborted()) {
                            this.abort(true);
                        }
                        this._deferred.reject(AbortError);
                        this._onEnded(e);
                    }
                };

                AESDecryptJob.prototype._onFinish = function(decryptedData) {
                    this.onFinish.dispatch(decryptedData);
                    this._deferred.resolve(decryptedData);
                    this._onEnded();
                };

                AESDecryptJob.prototype._onEnded = function(data) {
                    if(!this._finish) {
                        this._finish= true;
                        this._workerRunning = false;
                        if(this._worker) {
                            this._worker.removeEventListener('message', this._onMessageHandler, false);
                            this._worker.removeEventListener('error', this._onErrorHandler, false);
                            this._worker = null;
                        }
                        this.cipher = null;
                        this.iv = null;
                        this.key = null;
                        this._finish = true;
                        this.onDecryptEnded.dispatch(data);
                    }
                };

                AESDecryptJob.prototype._run = function() {
                    try {
                        this._workerRunning = true;
                        this._worker.postMessage({
                            iv: this.iv,
                            key: this.key,
                            cipher: this.cipher
                        });
                        this.onDecryptStart.dispatch(this);
                    } catch(e) {
                        this._deferred.reject(e);
                    }
                };

                AESDecryptJob.prototype._provideWorker = function(worker) {
                    if(!this.isFinish()){
                        this._worker = worker;
                        this._worker.addEventListener('message', this._onMessageHandler, false);
                        this._worker.addEventListener('error', this._onErrorHandler, false);
                        this._run();
                    }
                };

                AESDecryptJob.prototype.getPromise = function(){
                    return this._promise;
                };

                AESDecryptJob.prototype.isFinish = function(){
                    return this._finish || this._aborted;
                };

                AESDecryptJob.prototype.isWorkerRunning= function() {
                    return this._workerRunning;
                };

                AESDecryptJob.prototype.isWorkerTerminated = function() {
                    return this._workerTerminated;
                };

                AESDecryptJob.prototype.isAborted = function() {
                    return this._aborted;
                };

                AESDecryptJob.prototype.abort = function(fromEvent) {
                    if(!this.isFinish()) {
                        this._aborted = true;
                        if(this.isWorkerRunning()) {
                            this._workerTerminated = true;
                            this._worker.terminate();
                        }
                        if(!fromEvent) {
                            this._onError(AbortError);
                        }

                        this.onAbort.dispatch(void 0);
                    }
                };

                return AESDecryptJob;
            }();

            function AESDecrypter() {
                this._jobQueue = [];
                this._worker = null;
                this._destructed = false;
                this._currentJob = null;
            }

            AESDecrypter.prototype._buildWorker = function() {
                if(!this._worker) {
                    this._worker = new Worker(window.default_url+"addons/simple_mp3_player/js/decrypt.js");
                    return this._worker;
                }

                return null;
            };

            AESDecrypter.prototype.getWorker = function() {
                return this._worker ? this._worker : this._buildWorker();
            };

            AESDecrypter.prototype._onJobEnded = function(job) {
                if(this._currentJob === job) {
                    if(job.isWorkerTerminated()) {
                        this._worker = null;
                    }
                    this._currentJob = null;
                }
                this._performNextJob();
            };

            AESDecrypter.prototype._performNextJob = function() {
                if(this._jobQueue.length > 0) {
                    if(!this._currentJob || this._currentJob.isFinish()) {
                        this._currentJob = this._jobQueue.shift();
                        this._currentJob._provideWorker(this.getWorker());
                    }
                }
            };

            AESDecrypter.prototype._decryptJobObserver = function(job) {
                var that = this;
                this._jobQueue.push(job);
                job.onDecryptEnded.subscribe(function(){
                    that._onJobEnded(job);
                });

                this._performNextJob();
            };

            AESDecrypter.prototype._buildDecryptJob = function(cipher, iv, key) {
                var job = new AESDecryptJob(cipher, iv, key);
                this._decryptJobObserver(job);

                return job;
            };

            AESDecrypter.prototype.decrypt = function(cipher, iv, key) {
                return this._buildDecryptJob(cipher, iv, key);
            };

            AESDecrypter.prototype.destruct = function() {
                if(!this._destructed) {
                    if(this._currentJob) {
                        this._currentJob.abort();
                        this._currentJob = null;
                    }
                    this._jobQueue.forEach(function(job){
                        job.abort();
                    });
                    this._jobQueue = [];
                    this._destructed = true;
                }
            };


            return AESDecrypter;
        }();

        var BufferRequest = function() {

            var STALLED_TIME_MSEC = 18000;
            var RETRY_TIME_MSEC = 1200;
            var REQUESTER_ID = 0;

            function buildResponse(code, data, retryCount, aborted) {
                return {
                    code: code || -1,
                    data: data || null,
                    retryCount: retryCount || 0,
                    aborted: aborted
                }
            }

            var BaseRequest = function() {
                function BaseRequest(url, start, end) {
                    var that = this;
                    this._id = REQUESTER_ID++;
                    this._url = url;
                    this._rangeStart = start;
                    this._rangeEnd = end;
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
                    this._stalledTimerID = null;
                    this._retryCount = 0;
                    this._initTimerID = window.setTimeout(function(){
                        that._initTimerID = null;
                        that._run();
                    }, 0);
                }

                BaseRequest.prototype._run = function() {
                    return null;
                };

                BaseRequest.prototype._performRequest = function() {
                    return null;
                };

                BaseRequest.prototype._retry = function() {
                    this._retryCount++;
                    this._retryTimerID = window.setTimeout(this._run.bind(this), RETRY_TIME_MSEC);
                };

                BaseRequest.prototype._resolve = function(data) {
                    if(!this._settled) {
                        this._resolveHandler(data);
                        this._settled = true;
                    }
                };

                BaseRequest.prototype._reject = function(err) {
                    if(!this._settled) {
                        this._rejectHandler(err);
                        this._settled = true;
                    }
                };

                BaseRequest.prototype._clearRetryTimerID = function() {
                    if(this._retryTimerID !== null) {
                        window.clearTimeout(this._retryTimerID);
                    }
                    this._retryTimerID = null;
                };

                BaseRequest.prototype._clearStalledTimerID = function() {
                    if(this._stalledTimerID) {
                        window.clearTimeout(this._stalledTimerID);
                    }
                    this._stalledTimerID = null;
                };

                BaseRequest.prototype._setStalledTimerID = function() {
                    this._clearStalledTimerID();
                    this._stalledTimerID = window.setTimeout(this._onTimeout.bind(this), STALLED_TIME_MSEC);
                };

                BaseRequest.prototype._onTimeout = function() {
                    this._clearStalledTimerID();
                    this._abort();
                    this._run();
                };

                BaseRequest.prototype.abort = function() {
                    if(!this._settled) {
                        if(this._initTimerID !== null) {
                            window.clearTimeout(this._initTimerID);
                            this._initTimerID = null;
                        }
                        this._aborted = true;
                        this._clearRetryTimerID();
                        this._clearStalledTimerID();
                        this._reject(buildResponse(void 0, void 0, void 0, true));
                    }
                };

                BaseRequest.prototype.isSettled = function() {
                    return this._settled || this._aborted;
                };

                BaseRequest.prototype.isAborted = function() {
                    return this._aborted;
                };

                BaseRequest.prototype.getPromise = function() {
                    return this._promise;
                };

                return BaseRequest;
            }();

            var RequestToFetch = function() {

                function RequestToFetch(url, start, end) {
                    var that = BaseRequest.apply(this, arguments) || this;
                    that._AbortController = null;
                    that._requestJob = null;
                }

                __extend(RequestToFetch, BaseRequest);

                RequestToFetch.isSupported = function() {
                    return 'AbortController' in window && 'fetch' in window && 'Headers' in window;
                };

                RequestToFetch.prototype._run = function() {
                    if(!this.isSettled()) {
                        var that = this;
                        var requestJob = this._performRequest();
                        requestJob.promise.then(function(response) {
                            if(that.isAborted() || requestJob.aborted) {
                                return;
                            }
                            if(response.ok) {
                                response.arrayBuffer().then(function(data){
                                    that._clearStalledTimerID();
                                    that._resolve(buildResponse(response.status, data, that._retryCount, that.isAborted()));
                                })['catch'](function(e){

                                });
                            } else {
                                that._clearStalledTimerID();
                                if(response.status && response.status >=400 && response.status <= 500) {
                                    that._reject(buildResponse(response.status, null, that._retryCount, that.isAborted()));
                                } else {
                                    that._retry();
                                }
                            }
                            that._response = response;
                        })['catch'](function(e){
                            if(requestJob.aborted) {
                                return;
                            }
                            that._clearStalledTimerID();
                            if(!that._aborted) {
                                if(that._retryTimerID === null) {
                                    that._retry();
                                }
                            }
                        });
                        that._requestJob = requestJob;
                        that._setStalledTimerID();
                    }
                };

                RequestToFetch.prototype._abort = function() {
                    if(this._AbortController) {
                        this._requestJob.aborted = true;
                        this._AbortController.abort();

                    }
                };

                RequestToFetch.prototype.abort = function() {
                    if(!this._settled) {
                        this._abort();
                        BaseRequest.prototype.abort.call(this);
                    }
                };

                RequestToFetch.prototype._performRequest = function() {
                    this._clearRetryTimerID();
                    this._AbortController = new window.AbortController;
                    var headers = void 0;
                    if(this._rangeStart !== void 0 && this._rangeEnd !== void 0) {
                        headers = new window.Headers;
                        headers.append('Range', 'bytes='+this._rangeStart+'-'+this._rangeEnd);
                    }
                    var fetch = window.fetch(this._url, {
                        method: 'GET',
                        signal: this._AbortController.signal,
                        credentials: 'omit',
                        headers: headers
                    });
                    return {
                        promise: fetch,
                        aborted: false
                    };
                };


                return RequestToFetch;
            }();

            var RequestToXHR = function() {

                function isCompletedResponse(response) {
                    return response && response.status >= 200 && response.status < 300;
                }

                function buildResultObj(status, data) {
                    return {
                        status: status,
                        data: data
                    };
                }

                function RequestToXHR(url, start, end) {
                    var that = BaseRequest.apply(this, arguments) || this;
                    that._requestJob = null;
                    that._runHandler = null;
                }

                __extend(RequestToXHR, BaseRequest);

                RequestToXHR.prototype._onTimeout = function() {
                    BaseRequest.prototype._onTimeout.call(this);
                };

                RequestToXHR.prototype._run = function() {
                    if(!this.isSettled()) {
                        var that = this;
                        var requestJob = that._performRequest();
                        always(requestJob.promise).then(function(response){
                            if(!requestJob.aborted) {
                                that._clearStalledTimerID();
                                if(response.status >= 400 && response.status < 500) {
                                    that._reject(buildResponse(response.status, response.data, that._retryCount, that.isAborted()));
                                } else if(isCompletedResponse(response)) {
                                    that._resolve(buildResponse(response.status, response.data, that._retryCount, that.isAborted()));
                                } else {
                                    that._retry();
                                }
                            }
                        });
                        that._requestJob = requestJob;
                        that._setStalledTimerID();
                    }
                };

                RequestToXHR.prototype._performRequest = function() {
                    this._clearRetryTimerID();
                    var xhr = new XMLHttpRequest;
                    xhr.open('GET', this._url, true);
                    if(this._rangeStart !== void 0 && this._rangeEnd !== void 0) {
                        xhr.setRequestHeader('Range', 'bytes='+this._rangeStart+'-'+this._rangeEnd);
                    }

                    xhr.responseType = "arraybuffer";
                    var deferred = makeDeferred();
                    var job = {
                        xhr: xhr,
                        deferred: deferred,
                        promise: deferred.promise,
                        aborted: false
                    };
                    xhr.send();
                    xhr.addEventListener('readystatechange', function(evt){
                        if(xhr.status >= 400 && xhr.status < 500) {
                            deferred.reject(buildResultObj(xhr.status, null));
                        } else if(xhr.readyState === XMLHttpRequest.DONE) {
                            if(xhr.status === 200 || xhr.status === 206) {
                                deferred.resolve(buildResultObj(xhr.status, xhr.response));
                            } else {
                                deferred.reject(buildResultObj(0, null));
                            }
                        }
                    });

                    return job;
                };

                RequestToXHR.prototype._abort = function() {
                    if(this._requestJob && !this._requestJob.aborted) {
                        var xhr = this._requestJob.xhr;
                        xhr.abort();
                        this._requestJob.aborted = true;
                    }
                };

                RequestToXHR.prototype.abort = function() {
                    if(!this._settled) {
                        this._abort();
                        BaseRequest.prototype.abort.call(this);
                    }
                };

                return RequestToXHR;
            }();
            return {
                RequestToFetch: RequestToFetch,
                RequestToXHR: RequestToXHR
            };
        }();

        function getAudioBuffer(url, start, end) {
            url = convertURL2URI(url);
            var RequestToFetch = BufferRequest.RequestToFetch;
            var RequestToXHR = BufferRequest.RequestToXHR;
            var requester = RequestToFetch.isSupported() ? new RequestToFetch(url, start, end) : new RequestToXHR(url, start, end);

            return {
                promise: always(requester.getPromise.call(requester)),
                abort: requester.abort.bind(requester),
                isSettled: requester.isSettled.bind(requester)
            };
        }

        var BufferRetriever = function() {

            function buildResultObj(code, data, aborted, retryCount) {
                if(aborted === void 0) {
                    aborted = false;
                }
                if(retryCount === void 0) {
                    retryCount = 0;
                }
                return {
                    aborted: aborted,
                    code: code || -1,
                    data: data || null,
                    retryCount: retryCount
                };
            }

            var BaseBufferRetriever = function() {
                function BaseBufferRetriever() {
                    this._destructed = false;
                    this._encrypted = false;
                    this._key = null;
                    this._initialized = false;
                    this._keyRetriever = null;
                    this._bufferRetriever = [];

                    this._init();
                }

                BaseBufferRetriever.prototype._init = function() {
                    this._initialized = true;
                };

                BaseBufferRetriever.prototype.isEncrypted = function() {
                    return null;
                };

                BaseBufferRetriever.prototype.isInitialized = function() {
                    return this._initialized;
                };

                BaseBufferRetriever.prototype.isKeyRetrieving = function() {
                    return !!this._keyRetriever && !this._keyRetriever.isSettled();
                };

                BaseBufferRetriever.prototype.getBuffer = function(url) {
                    return null;
                };

                BaseBufferRetriever.prototype.abortKeyRetriever = function() {
                    if(this.isKeyRetrieving()) {
                        this._keyRetriever.abort();
                    }
                    this._keyRetriever = null;
                };

                BaseBufferRetriever.prototype.abort = function() {
                    this.abortKeyRetriever();
                    this._bufferRetriever.forEach(function(retriever) {
                        retriever.abort();
                    });
                };

                BaseBufferRetriever.prototype.destruct = function() {
                    if(!this._destructed) {
                        this.abort();
                        this._bufferRetriever = [];
                        this._destructed = true;
                    }
                };

                return BaseBufferRetriever;
            }();

            var BufferRetriever = function () {

                function BufferRetriever() {
                    var that = BaseBufferRetriever.call(this) || this;
                }

                __extend(BufferRetriever, BaseBufferRetriever);

                BufferRetriever.prototype._init = function() {
                    BaseBufferRetriever.prototype._init.call(this);
                };

                BufferRetriever.prototype._observeBufferRetriever = function(retriever) {
                    var that = this;
                    this._bufferRetriever.push(retriever);
                    always(retriever.promise).then(function(){
                        var idx = that._bufferRetriever.indexOf(retriever);
                        if(idx > -1) {
                            that._bufferRetriever.splice(idx, 1);
                        }
                    });
                };

                BufferRetriever.prototype.getBuffer = function(url, start, end) {
                    var retriever = getAudioBuffer(url, start, end);
                    this._observeBufferRetriever(retriever);
                    return retriever;
                };

                BufferRetriever.prototype.isEncrypted = function() {
                    return false;
                };

                return BufferRetriever;
            }();

            var EncryptedBufferRetriever = function() {

                var keyPair = ['handshake', 'timestamp', 'document_srl', 'file_srl', 'ip'];
                var decrypter = new AESDecrypter;
                var KeyBufferMediator = function() {

                    function KeyBufferMediator(keyRetriever, bufferBuilder, iv) {
                        this._deferred = makeDeferred();
                        this._aborted = false;
                        this._settled = false;
                        this.promise = this._deferred.promise;
                        this._keyRetriever = keyRetriever;
                        this._bufferBuilder = bufferBuilder;
                        this._bufferRetriever = null;
                        this._decrypter = null;
                        this._retrievedData = null;
                        this._iv = iv || null;
                        this._run();
                    }

                    KeyBufferMediator.prototype._run = function() {
                        var that = this;
                        var encKey = null;
                        this._keyRetriever.promise.then(function(key){
                            if(!that.isSettled()) {
                                encKey = new Uint8Array(key.data);
                                that._bufferRetriever = that._bufferBuilder();
                                return that._bufferRetriever.promise;
                            }
                        }).then(function(result) {
                            if(!that.isSettled()) {
                                that._retrievedData = result;
                                var encryptedBuffer = new Uint8Array(result.data);
                                var cipherTextRaw = that._iv ? encryptedBuffer : encryptedBuffer.slice(48, encryptedBuffer.byteLength);
                                var iv = that._iv ? that._iv : encryptedBuffer.slice(0, 16);
                                this._decrypter = decrypter.decrypt(cipherTextRaw, iv, encKey);

                                return this._decrypter.getPromise();
                            }
                        }).then(function(data){
                            if(!that.isSettled()) {
                                that._retrievedData.data = data;
                                that._deferred.resolve(that._retrievedData);
                            }
                        })['catch'](function(e){
                            that._deferred.reject(e);
                            that._settled = true;
                        });
                    };

                    KeyBufferMediator.prototype.abort = function() {
                        if(!this.isSettled()) {
                            if(this._bufferRetriever) {
                                if(!this._bufferRetriever.isSettled()) {
                                    this._bufferRetriever.abort();
                                }
                                this._bufferRetriever = null;
                            }
                            if(this._decrypter) {
                                this._decrypter.abort();
                                this._decrypter = null;
                            }
                            this._aborted = true;
                        }
                    };

                    KeyBufferMediator.prototype.isSettled = function() {
                        return this._aborted || this._settled;
                    };

                    return KeyBufferMediator;
                }();

                var getURLParameter = function(audioURL) {
                    var url = new URL((window.default_url+audioURL).replace(/(\/.\/)/, '/'));
                    var obj = {};
                    if(keyPair) {
                        keyPair.forEach(function(key){
                            var val = url.searchParams.get(key);
                            if(val) {
                                obj[key] = val;
                            }
                        });
                    }

                    return obj;
                };

                var getKeyRetreiverDecorator = function(promise) {
                    return {
                        promise: promise,
                        abort: function(){},
                        isSettled: function(){return true;}
                    };
                };

                function EncryptedBufferRetriever() {
                    var that = BufferRetriever.call(this) || this;
                    that._handshake = null;
                }

                __extend(EncryptedBufferRetriever, BufferRetriever);

                EncryptedBufferRetriever.prototype.onKeyRetrieved = function(keyData) {
                    if(keyData && keyData.data) {
                        this._handshake = keyData.handshake;
                        this._key = new Uint8Array(keyData.data);
                    }
                };

                EncryptedBufferRetriever.prototype._buildKeyRetriever = function(keyURL) {
                    return getAudioBuffer(keyURL);
                };

                EncryptedBufferRetriever.prototype._updateKeyRetriever = function(keyURL) {
                    var that = this;
                    var retriever = this._buildKeyRetriever(keyURL);
                    var params = getURLParameter(keyURL);
                    if(retriever) {
                        this._keyRetriever = retriever;
                        this._handshake = params._handshake;
                        retriever.promise.then(function(data){
                            that.onKeyRetrieved({
                                data: data.data,
                                handshake: params.handshake
                            });
                        })['catch'](function(e) {

                        });

                        return retriever;
                    }

                    return null;
                };

                EncryptedBufferRetriever.prototype.isValidKey = function(keyURL) {
                    var params = getURLParameter(keyURL);
                    return params.handshake === this._handshake && !!this._key;
                };

                EncryptedBufferRetriever.prototype.getKeyRetriever = function(keyURL) {
                    var params = getURLParameter(keyURL);
                    if(this.isValidKey(keyURL)) {
                        return getKeyRetreiverDecorator(Promise.resolve(buildResultObj(200, this._key)));
                    } else {
                        if(this.isKeyRetrieving()) {
                            if(params.handshake === this._handshake) {
                                return this._keyRetriever;
                            }
                            this.abortKeyRetriever();
                        }
                        this.resetKey();
                        var retriever = this._updateKeyRetriever(keyURL);
                        if(retriever) {
                            return retriever;
                        }
                        return getKeyRetreiverDecorator(Promise.reject(void 0));
                    }
                };

                EncryptedBufferRetriever.prototype.resetKey = function() {
                    this._handshake = null;
                    this._key = null;
                };

                EncryptedBufferRetriever.prototype._buildBufferRetriever = function(audioURL) {
                    return BufferRetriever.prototype.getBuffer.call(this, audioURL);
                };

                EncryptedBufferRetriever.prototype.getBuffer = function(audioURL, keyURL, iv) {
                    return new KeyBufferMediator(this.getKeyRetriever(keyURL), this._buildBufferRetriever.bind(this, audioURL), iv);
                };

                EncryptedBufferRetriever.prototype.isEncrypted = function() {
                    return true;
                };

                return EncryptedBufferRetriever;
            }();

            return {
                EncryptedBufferRetriever: EncryptedBufferRetriever,
                BufferRetriever: BufferRetriever
            };

        }();

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

        function MSE(audioNode, playlist, config) {
            if(config === void 0) {
                config = {
                    file_srl: null,
                    bufferSize: MAX_BUFFER_SIZE,
                    mp3url: null
                };
            }

            this._id = MSE_ID++;
            this._audio = audioNode;
            this._file_srl = config.file_srl;
            this._playlist = playlist;
            this._duration = this._playlist ? this._playlist.duration : 0;
            this._BufferRetriever = this._playlist && this._playlist.encrypted ? new BufferRetriever.EncryptedBufferRetriever : new BufferRetriever.BufferRetriever;
            this._offsets = this._playlist ? normalizeOffsetList(this._playlist.offsets) : null;
            this._mp3URL = config.mp3url;
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
            this._onMediaSourceCloseHandler = this._onMediaSourceClose.bind(this);
            this._onMediaSourceErrorHandler = this._onMediaSourceError.bind(this);
            this._onSourceBufferUpdateEndHandler = this._onSourceBufferUpdateEnd.bind(this);
            this._onSourceBufferErrorHandler = this._onSourceBufferError.bind(this);
            this._currentPerformJob = null;
            this._CacheManager = null;
            this._bufferSize = config.bufferSize && typeof config.bufferSize === 'number' ? config.bufferSize : MAX_BUFFER_SIZE;
            this._MediaSource.addEventListener("sourceopen", this._onMediaSourceInitHandler, false);
            this._MediaSource.addEventListener("sourceclose", this._onMediaSourceCloseHandler, false);
            this._MediaSource.addEventListener("error", this._onMediaSourceErrorHandler, false);
            this._jobQueue = [];
            this._seeking = false;
            this._request = null;
            this._eosSignalled = false;
            this._lastSegmentIndex = -1;
            this._playingObserverTimerID = null;

            this._MSEInitialized = false;

            this._init();
        }

        MSE.helper = {
            getAudioBuffer: getAudioBuffer
        };

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
            if(!this.isDestructed()) {
                this._ensureNotDestructed();
                this._audio.addEventListener('seeking', this._onAudioSeekingHandler, false);
                this._audio.addEventListener('timeupdate', this._onAudioTimeUpdateHandler, false);
                this._audio.src = this.getURL();
                try {
                    this._audio.load();
                } catch(e){
                    console.error(e);
                }

                if(this._bufferSize > 180) {
                    this._bufferSize = 180;
                }
                if(this._bufferSize < 1) {
                    this._bufferSize = MAX_BUFFER_SIZE;
                }
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

        MSE.prototype._provideOffsetList = function(playlist) {
            if(!this.isClosed()) {
                this._playlist = playlist;
                this._offsets = normalizeOffsetList(this._playlist.offsets);
                this._duration = this._playlist.duration;
                this._BufferRetriever = this._playlist.encrypted ? new BufferRetriever.EncryptedBufferRetriever : new BufferRetriever.BufferRetriever;
                if(this._MSEInitialized && !this._initialized) {
                    this._onMediaSourceInit();
                }
            }
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
            if(result.aborted || this.isClosed()) {
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
                var buffer = removdID3Tag(new Uint8Array(result.data));
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
            this._MSEInitialized = true;
            if(!this.isClosed() && !this._initialized && this._offsets) {
                this._initialized = true;
                this._MediaSource.duration = this._duration || Infinity;
                this._MediaSource.removeEventListener("sourceopen", this._onMediaSourceInitHandler, false);
                this._MediaSource.removeEventListener("sourceended", this._onMediaSourceInitHandler, false);
                this._sourceBuffer = this._addSourceBuffer(this._mimeCodec);
                this._sourceBuffer.addEventListener('updateend', this._onSourceBufferUpdateEndHandler, false);
                this._sourceBuffer.addEventListener('error', this._onSourceBufferErrorHandler, false);
                this.performNextAction();
            }
        };

        MSE.prototype._onMediaSourceEnded = function(evt) {

        };

        MSE.prototype.isClosed = function() {
            return !this._audio.hasAttribute('src') || this.isDestructed();
        };

        MSE.prototype._onMediaSourceClose = function() {
            if(!this.isDestructed()) {
                this.destruct();
            }
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
        };

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

        MSE.prototype.getBufferRetriever = function(url, start, end) {
            return this._BufferRetriever.getBuffer(url, start, end);
        };

        MSE.prototype.performNextAction = function() {
            this._ensureNotDestructed();
            if(this._sourceBuffer && !this._seeking && !this.isEOSSignalled() && !this.isClosed()) {
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
                            this._request = idxData.url ? this.getBufferRetriever(idxData.url, idxData.key, idxData.iv ? idxData.iv : void 0) :  this.getBufferRetriever(this._mp3URL, idxData.startOffset, idxData.endOffset);
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
            if(this._CacheManager && this._file_srl && start && end) {
                return this._CacheManager.getCache(this._file_srl, start, end);
            }

            return null;
        };

        MSE.prototype.setCache = function(data, start, end) {
            if(this._CacheManager && this._file_srl) {
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
                var that = this;
                this._sourceBuffer.removeEventListener('updateend', this._onSourceBufferUpdateEndHandler, false);
                this._sourceBuffer.removeEventListener('error', this._onSourceBufferErrorHandler, false);
                if(Array.prototype.some.call(this._MediaSource.sourceBuffers, function(sourceBuffer){
                    return sourceBuffer === that._sourceBuffer;
                })) {
                    this._MediaSource.removeSourceBuffer(this._sourceBuffer);
                }
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
                this._BufferRetriever.destruct();
                this._BufferRetriever = null;
                if(this._request && !this._request.isSettled()) {
                    this._request.abort();
                }
                this._audio.removeEventListener('seeking', this._onAudioSeekingHandler, false);
                this._audio.removeEventListener('timeupdate', this._onAudioTimeUpdateHandler, false);
                if(!this._initialized) {
                    this._MediaSource.removeEventListener('sourceopen', this._onMediaSourceInitHandler, false);
                }
                this._MediaSource.removeEventListener('sourceended', this._onMediaSourceEndedHandler, false);
                this._MediaSource.removeEventListener("sourceclose", this._onMediaSourceCloseHandler, false);
                this._MediaSource.removeEventListener("error", this._onMediaSourceErrorHandler, false);
                this._removeSourceBuffer();
                if(this._audio.src) {
                    this._audio.removeAttribute('src');
                    this._audio.load();
                }
                this._revokeURL();
                this._audio = null;
                this._CacheManager = null;
            }
        };

        return MSE;
    }();

    var SimpleHLS = function() {

        var PLAYER_TYPE, ENCRYPT_TYPE;
        (0, function() {
            PLAYER_TYPE[PLAYER_TYPE.VOD = 0] = "VOD";
            PLAYER_TYPE[PLAYER_TYPE.LIVE = 1] = "LIVE";
            PLAYER_TYPE[PLAYER_TYPE.EVENT = 2] = "EVENT";
        })(PLAYER_TYPE || (PLAYER_TYPE = {}));
        (0, function() {
            ENCRYPT_TYPE[ENCRYPT_TYPE.NONE = 0] = "NONE";
            ENCRYPT_TYPE[ENCRYPT_TYPE.AES_128 = 1] = "AES_128";
            ENCRYPT_TYPE[ENCRYPT_TYPE.SAMPLE_AES = 2] = "SAMPLE_AES";
        })(ENCRYPT_TYPE || (ENCRYPT_TYPE = {}));

        var MSEHelper = MSE.helper;
        var getAudioBuffer = MSEHelper.getAudioBuffer;

        var TimeRange = function() {
            function TimeRange(start, duration, end) {
                if(start < 0 || duration <= 0) {
                    throw new Error("Invalid TimeRange argument error.");
                }
                this.start = start;
                this.duration = duration;
                this.end = end || start + duration;
            }

            TimeRange.sortTimeRanges = function(timeRanges) {
                return timeRanges.slice(0).sort(function(one, two) {
                    return two.start - one.start;
                });
            };

            TimeRange.normalizeTimeRanges = function(timeRanges) {
                return TimeRange.sortTimeRanges(timeRanges).reduce(function(accmulator, currentValue, currentIndex) {
                    var accmulatorLastIndex = accmulator.length - 1;
                    if(currentIndex > 0 && currentValue.start <= accmulator[accmulatorLastIndex].end) {
                        accmulator[accmulatorLastIndex].end = currentValue.end;
                    } else {
                        accmulator.push(currentValue);
                    }
                    return accmulator;
                }, []).map(function(currentTimeRange) {
                    var start = currentTimeRange.start;
                    var end = currentTimeRange.end;
                    var duration = end-start;
                    return new TimeRange(start, duration, end);
                });
            };

            return TimeRange;
        }();

        var makeTimeRanges = function(buffered, timescale) {
            var bufferedLen = buffered.length;
            var timeRanges = [];
            if(timescale === void 0) {
                timescale = 1;
            }
            for(var i=0; i<bufferedLen; i++) {
                timeRanges.push({
                    start: buffered.start(i) * timescale,
                    end: buffered.end(i) * timescale
                });
            }
            return TimeRange.normalizeTimeRanges(timeRanges);
        };

        var M3U8Playlist = function() {
            var regex = /(?:(?:#(EXTM3U))|(?:#EXT-X-(PLAYLIST-TYPE):(.+))|(?:#EXT-X-(MEDIA-SEQUENCE): *(\d+))|(?:#EXT-X-(ALLOWCACHE): *(\w+))|(?:#EXT-X-(TARGETDURATION): *(\d+))|(?:#EXT-X-(KEY):(.+))|(?:#EXT-X-(MAP):(.+))|(?:#EXT-X-(START):(.+))|(?:#EXT(INF): *(\d+(?:\.\d+)?)(?:,(.*))?)|(?:(?!#)()(\S.+))|(?:#EXT-X-(BYTERANGE): *(\d+(?:@\d+(?:\.\d+)?)?)|(?:#EXT-X-(ENDLIST))|(?:#EXT-X-(DISCONTINUITY-SEQ)UENCE:(\d+))|(?:#EXT-X-(DIS)CONTINUITY))|(?:#EXT-X-(PROGRAM-DATE-TIME):(.+))|(?:#EXT-X-(VERSION):(\d+))|(?:(#)(.*):(.*))|(?:(#)(.*)))(?:.*)\r?\n?/g;
            var regex1 = /(.+?)=(.+?)(?:,|$)/g;
            var regex2 = /^\d*(\.\d+)?$/;

            function readMapString(mapString) {
                if(mapString.indexOf('"') === 0 && mapString.lastIndexOf('"') === mapString.length-1) {
                    return mapString.slice(1, -1);
                } else {
                    return mapString;
                }
            }

            function parseMap(mpaData) {
                var data = {};
                regex1.lastIndex = 0;
                var readRegex;
                while((readRegex = regex1.exec(mpaData)) !== null) {
                    var index = readRegex[1].trim().toLowerCase();
                    var str = readMapString(readRegex[2].trim());
                    data[index] = str;
                }
                return data;
            }


            function ivToBuffer(ivH16Str) {
                if(ivH16Str.indexOf("0x") === 0) {
                    ivH16Str = ivH16Str.substr(2);
                }
                var ivBuffer = new Uint16Array(8);
                if(ivH16Str.length % 4 != 0) {
                    throw new Error("Failed to parse IV (length is not multiple of 4).");
                }
                for(var i=0; i< ivH16Str.length; i+=4) {
                    var num = parseInt(ivH16Str.substr(i, 4), 16);
                    if(isNaN(num)) {
                        throw new Error("Failed to parse hex number in IV string.");
                    }
                    ivBuffer[i/4] = num
                }

                return new Uint8Array(ivBuffer);
            }

            function sequenceToIV(sequence){
                var iv = new Uint8Array(16);
                for(var i=12; i<16; i++) {
                    iv[i] = sequence >> 8 * (15 - i) & 255;
                }

                return iv;
            }


            function M3U8Playlist(m3u8) {
                this._data = null;
                this._data = this.parse(m3u8);
            }

            M3U8Playlist.prototype.parse = function(m3u8) {
                var data = this._data;
                var info = {
                    version: null,
                    type: PLAYER_TYPE.VOD,
                    mediaSequence: null,
                    targetDuration: null,
                    totalDuration: 0,
                    allowCache: null,
                    ended: false
                };
                regex.lastIndex = 0;
                var segmentIndexes = [];
                var tmpParse;
                var tmpDuration = null;
                var parseIndex = 0;
                var mapStr = null;
                var encryptData = {
                    method: ENCRYPT_TYPE.NONE,
                };
                var segmentSequence = 0;
                while((tmpParse = regex.exec(m3u8)) !== null) {
                    var filterLine = tmpParse.filter(function(each, index) {
                        return index === 0 ? false : each !== void 0;
                    }).map(function(each, index) {
                        return index === 0 ? each.toLowerCase() : each;
                    });

                    var firstLine = filterLine[0];
                    var copyLine = filterLine.slice(1);
                    var headerProcessed = false;
                    if(parseIndex === 0) {
                        if(firstLine !== "extm3u") {
                            throw new Error("First line did not contain EXTM3U tag.");
                        }
                    } else {
                        if(!headerProcessed) {
                            switch(firstLine) {
                                case "playlist-type":
                                    if(info.type !== PLAYER_TYPE.LIVE) {
                                        throw new Error("Already have playlist type.");
                                    }
                                    switch (copyLine[0].toLowerCase()) {
                                        case "vod":
                                            info.type = PLAYER_TYPE.VOD;
                                            break;
                                        case "event":
                                            info.type = PLAYER_TYPE.EVENT;
                                            break;
                                        default:
                                            throw new Error("Invalid playlist type.");
                                    }
                                    break;
                                case "media-sequence":
                                    if (info.mediaSequence !== null) {
                                        throw new Error("Already have media sequence number.");
                                    }
                                    var sequence = parseInt(copyLine[0], 10);
                                    if (copyLine[0] !== sequence+"") {
                                        throw new Error("Invalid media sequence number.");
                                    }
                                    info.mediaSequence = sequence;
                                    segmentSequence = sequence;
                                    break;

                                case "allowcache":
                                    info.allowCache = copyLine[0].toLowerCase() === "YES";
                                    break;

                                case "targetduration":
                                    if (info.targetDuration !== null) {
                                        throw new Error("Already have target duration.");
                                    }
                                    var _targetduration = parseInt(copyLine[0], 10);
                                    if (copyLine[0] !== _targetduration + "" || _targetduration < 0) {
                                        throw new Error("Invalid target duration.");
                                    }
                                    info.targetDuration = 1000 * _targetduration;
                                    break;

                                case "version":
                                    if (info.version !== null) {
                                        throw new Error("Already have version.");
                                    }
                                    var _version = parseInt(copyLine[0], 10);
                                    if (copyLine[0] !== _version + "") {
                                        throw new Error("Invalid version.");
                                    }
                                    if (_version < 3) {
                                        throw new Error("HLS version must be 3 or above.");
                                    }
                                    info.version = _version;
                                    break;
                                default:
                                    headerProcessed = true;
                            }
                        }

                        if(headerProcessed) {
                            switch(firstLine) {

                                case "key":
                                    mapStr = parseMap(copyLine[0]);
                                    var method = "method" in mapStr ? mapStr.method.toLowerCase() : null;
                                    var keyURL = "uri" in mapStr ? mapStr.uri : null;
                                    var iv = "iv" in mapStr ? ivToBuffer(mapStr.iv) : null;
                                    if(!method) {
                                        throw new Error("Missing encryption method.");
                                    }
                                    if(method !== "none" && !keyURL) {
                                        throw new Error("Missing key url.");
                                    }
                                    switch (method) {
                                        case "none":
                                            if(keyURL !== null) {
                                                throw new Error("Key url not allowed.");
                                            }
                                            if(iv !== null) {
                                                throw new Error("IV not allowed.");
                                            }
                                            encryptData = {
                                                method: ENCRYPT_TYPE.NONE
                                            };
                                            break;

                                            break;
                                        case "aes-128":
                                            if (!keyURL) {
                                                throw new Error("Key url required.");
                                            }
                                            encryptData = {
                                                method: ENCRYPT_TYPE.AES_128,
                                                keyUrl: keyURL,
                                                iv: iv
                                            };
                                            break;
                                        case "sample-aes":
                                            if (!keyURL) {
                                                throw new Error("Key url required.");
                                            }
                                            encryptData = {
                                                method: ENCRYPT_TYPE.SAMPLE_AES,
                                                keyUrl: keyURL,
                                                iv: iv
                                            };
                                            break;

                                        default:
                                            throw new Error("Unknown encryption method.");

                                    }

                                    break;

                                case "map":
                                    //FIXME
                                    mapStr = parseMap(copyLine[0]);
                                    if (!("uri" in mapStr)) {
                                        throw new Error("URI missing from EXT-X-MAP tag.");
                                    }
                                    if ("byterange" in mapStr) {
                                        throw new Error("BYTERANGE in EXT-X-MAP tag is currently unsupported.");
                                    }
                                    var mapUrl = mapStr;
                                    break;
                                case "inf":
                                    if (!copyLine[0].match(regex2)) {
                                        throw new Error("Invalid segment duration.");
                                    }
                                    tmpDuration = 1000 * parseFloat(copyLine[0]);
                                    break;
                                case "":
                                    if (info.ended) {
                                        throw new Error("Already received ENDLIST tag.");
                                    }
                                    if(tmpDuration === null) {
                                        throw new Error("Not received segment duration.");
                                    }
                                    segmentIndexes.push({
                                        url: copyLine[0],
                                        timeRange: new TimeRange(info.totalDuration, tmpDuration),
                                        encryptData: {
                                            method: encryptData.method,
                                            keyUrl: encryptData.keyUrl ? encryptData.keyUrl : null,
                                            iv: encryptData.iv ?  encryptData.iv :
                                                encryptData.keyUrl ? sequenceToIV(segmentSequence) : null
                                        }
                                    });

                                    info.totalDuration += tmpDuration;
                                    tmpDuration = null;
                                    segmentSequence++;
                                    break;
                                case "endlist":
                                    if (info.ended) {
                                        throw new Error("Already had ENDLIST tag.");
                                    }
                                    info.ended = !0;
                                    break;
                                default:
                                    console.warn("Unable to parse playlist line.", firstLine);
                            }
                        }

                    }

                    parseIndex++;
                }

                var version = info.version;
                var type = info.type;
                var mediaSequence = info.mediaSequence;
                var targetDuration = info.targetDuration;
                var ended = info.ended;
                var totalDuration = info.totalDuration;
                if(version === null) {
                    throw new Error("Missing version.");
                }
                if(targetDuration === null) {
                    throw new Error("Missing target duration.");
                }
                if(ended && type === PLAYER_TYPE.LIVE) {
                    throw new Error("Cannot be ended if type is LIVE.");
                }
                if(!ended && type === PLAYER_TYPE.VOD) {
                    throw new Error("Must be ended if type is VOD.");
                }
                if(mediaSequence === null) {
                    mediaSequence = 0;
                }
                if(data) {
                    if (data.type !== type) {
                        throw new Error("Playlist type has changed since last update.");
                    }
                    if (data.type === PLAYER_TYPE.EVENT && mediaSequence !== data.mediaSequence) {
                        throw new Error("Media sequence number has changed. Not valid for EVENT playlist.");
                    }
                    var contactSegment = info.segments[mediaSequence - info.mediaSequence];
                    if(!contactSegment) {
                        throw new Error("Tracking lost. The last segment of the previous playlist is no longer in the new one.");
                    }
                    var contactSegmentStart = contactSegment.timeRange.start;
                    segmentIndexes.forEach(function(each) {
                        var timeRange = each.timeRange;
                        each.timeRange = new TimeRange(timeRange.start+contactSegmentStart, timeRange.duration);
                    });
                    totalDuration += contactSegmentStart;
                }

                return {
                    version: version,
                    type: type,
                    mediaSequence: mediaSequence,
                    targetDuration: targetDuration,
                    totalDuration: totalDuration,
                    ended: ended,
                    segments: segmentIndexes
                };
            };

            M3U8Playlist.prototype._calculatePlaylist = function() {
                if(this._playlist) {
                    var duration = 0;
                    this._playlist.forEach(function(eachSegmentInfo) {
                        duration += eachSegmentInfo.duration;
                    });
                    this._duration = duration;
                }
            };

            M3U8Playlist.prototype.hasEnded = function() {
                if(!this._playlist) {
                    throw new Error("Not loaded yet.");
                }
            };

            M3U8Playlist.prototype.getSegmentCount = function() {
                if(!this._data) {
                    throw new Error("Not loaded yet.");
                }
                return this._data.segments.length;
            };

            M3U8Playlist.prototype.getType = function() {
                if(!this._data) {
                    throw new Error("Not loaded yet.");
                }
                return this._data.type;
            };

            M3U8Playlist.prototype.getSegment = function(index) {
                if(!this._data) {
                    throw new Error("Not loaded yet.");
                }
                return this._data.segments[index];
            };

            M3U8Playlist.prototype.getSegmentByPosition = function(position) {
                if(!this._data) {
                    throw new Error("Not loaded yet.");
                }
                var index = null;
                var segment = this._data.segments.find(function(segment, currentIndex){
                    var timeRange = segment.timeRange;
                    if(position >= timeRange.start && position <= timeRange.end) {
                        index = currentIndex;
                        return true;
                    }
                });
                return segment ? {
                    index: index,
                    segment: segment
                } : null;
            };

            M3U8Playlist.prototype.getDuration = function() {
                return this._data.totalDuration;
            };

            M3U8Playlist.prototype.getEntireData = function() {
                return this._data;
            };

            M3U8Playlist.prototype.merge = function(m3u8Parser) {
                if(m3u8Parser instanceof M3U8Playlist) {

                }
            };

            return M3U8Playlist;
        }();

        var M3U8Retriever = function() {
            function M3U8Retriever(url) {
                var that = this;
                this._deferred = makeDeferred();
                this._promise = this._deferred.promise;
                this._request = getAudioBuffer(url);
                this._aborted = false;
                this._ended = false;
                this._request.promise.then(function(result){
                    if(result.data) {
                        that._onLoad(String.fromCharCode.apply(null, new Uint8Array(result.data)));
                    } else {
                        that._onFailure(result);
                    }
                });
            }

            M3U8Retriever.prototype._resolve = function(data) {
                if(!this._ended) {
                    this._deferred.resolve(data);
                    this._ended = true;
                }
            };

            M3U8Retriever.prototype._reject = function(err) {
                if(!this._ended) {
                    this._deferred.reject(err);
                    this._ended = true;
                }
            };

            M3U8Retriever.prototype._onLoad = function(playlist) {
                try {
                    var playlistParser = new M3U8Playlist(playlist);
                    return this._resolve(playlistParser.getEntireData());
                } catch(err) {
                    return this._onFailure(err);
                }
            };

            M3U8Retriever.prototype._onFailure = function(err) {
                this._reject(err);
            };

            M3U8Retriever.prototype.getPromise = function() {
                return this._promise;
            };

            M3U8Retriever.prototype.isEnded = function() {
                return this._aborted || this._ended;
            };

            M3U8Retriever.prototype.abort = function() {
                if(this._request && !this._request.isSettled()) {
                    this._request.abort();
                    this._aborted = true;
                }
            };

            return M3U8Retriever;

        }();

        var DestructError = new Error("Destructed");

        function getParameterByName(name, url) {
            if (!url) {
                url = window.location.href;
            }
            name = name.replace(/[\[\]]/g, '\\$&');
            var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
            var results = regex.exec(url);
            if (!results) {
                return null;
            }
            if (!results[2]) {
                return '';
            }

            return decodeURIComponent(results[2].replace(/\+/g, ' '));
        }

        function getByteOffsetByPlaybackURL(url) {
            var offsetParams = {
                startOffset: null,
                endOffset: null
            };
            if(url) {
                try {
                    var startOffset = parseInt(getParameterByName('start', url), 10);
                    var endOffset = parseInt(getParameterByName('end', url), 10);
                    if(!isNaN(startOffset)) {
                        offsetParams.startOffset = startOffset;
                    }
                    if(!isNaN(endOffset)) {
                        offsetParams.endOffset = endOffset;
                    }
                } catch(e){
                    console.error(e);
                }
            }

            return offsetParams;
        }

        function M3U8Data2OffsetList(M3U8Data) {
            return M3U8Data.segments.reduce(function(data, segment){
                var timeRange = segment.timeRange;
                var encryptData = segment.encryptData;
                var offsetParams = getByteOffsetByPlaybackURL(segment.url);
                var offset = {
                    start: timeRange.start,
                    end: timeRange.end,
                    time: timeRange.duration / 1000,
                    startOffset: offsetParams.startOffset,
                    endOffset: offsetParams.endOffset
                };
                if(segment.url) {
                    offset.url = segment.url;
                }
                if(encryptData && encryptData.method !== ENCRYPT_TYPE.NONE) {
                    data.encrypted = true;
                    offset.key = encryptData.keyUrl;
                    offset.iv = encryptData.iv;
                }

                data.offsets.push(offset);

                return data;
            }, {
                encrypted: false,
                duration: M3U8Data.totalDuration / 1000,
                offsets: []
            })
        }

        // Adapter
        function SimpleHLS(audioNode, m3u8URL, file_srl, bufferSize){
            var that = this;
            this._audioNode = audioNode;
            this._m3u8URL = m3u8URL;
            this._file_srl = file_srl;
            this._bufferSize = bufferSize;
            this._retreiver = new M3U8Retriever(m3u8URL);
            this._MSE = new MSE(this._audioNode, null, {
                file_srl: this._file_srl,
                bufferSize: this._bufferSize
            });
            this._destructed = false;
            this._playlist = null;
            this._offsetList = null;
            this._retreiver.getPromise().then(function(playlist) {
                that._playlist = playlist;
                that._onPlaylistLoad(playlist);
            })['catch'](function(err){
                console.error(err);
                that.destruct();
            });
            this._cacheManager = null;
        }


        SimpleHLS.prototype._initMSE = function(offsetList) {
            this._MSE._provideOffsetList(offsetList);
            if(this._cacheManager) {
                this._MSE.provideCacheManager(this._cacheManager);
            }
        };

        SimpleHLS.prototype._onPlaylistLoad = function(playlist) {
            this._offsetList = M3U8Data2OffsetList(playlist);
            this._initMSE(this._offsetList);
        };

        SimpleHLS.prototype.provideCacheManager = function(cacheManager) {
            if(this._MSE) {
                this._MSE.provideCacheManager(cacheManager);
            } else {
                this._cacheManager = cacheManager;
            }
        };

        SimpleHLS.prototype.destruct = function() {
            if(!this._destructed) {
                if(this._retreiver && !this._retreiver.isEnded()) {
                    this._retreiver.abort();
                    this._retreiver = null;
                }
                if(this._MSE) {
                    this._MSE.destruct();
                    this._MSE = null;
                }

                this._destructed = true;
            }
        };

        return SimpleHLS;
    }();

    var PlayerObserver = function() {
        function PlayerObserver(player) {
            this.onPlaying = new EventDispatcher;
            this.onDestructed = new EventDispatcher;
            this._player = player;
            this._onAudioPlayingHandler = null;
            this._onDestructedHandler = null;
        }

        PlayerObserver.prototype.getAutoplayPriority = function() {
            return 100;
        };

        PlayerObserver.prototype.onAudioPlaying = function() {
            this.onPlaying.dispatch(this);
        };

        PlayerObserver.prototype.onAudioDestructed = function() {
            this.onDestructed.dispatch(this);
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
            var url = window.request_uri+'index.php?mid='+window.current_mid+'&act=getSimpleMP3Descriptions&document_srl='+document_srl;
            if(!MSE.isSupported()) {
                url += "&hls=false";
            }
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
                    if(tags.title) {
                        tags.title = ampToAmp(tags.title);
                    }
                    if(tags.artist) {
                        tags.artist = ampToAmp(tags.artist);
                    }
                    if(tags.album) {
                        tags.album = ampToAmp(tags.album);
                    }
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
                            } else if(description.offsetInfo && description.offsetInfo.offsets && description.offsetInfo.offsets.length > 0) {
                                audioDescriptions.push(each);
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
    $SimpleMP3Player.MSE = MSE;
    $SimpleMP3Player.SimpleHLS = SimpleHLS;

})(window.$SimpleMP3Player || (window.$SimpleMP3Player = {}));
