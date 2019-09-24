importScripts('./aesjs.js');
self.addEventListener('message', function(evt){
    var data = evt.data;
    try {
        var aesCbc = new aesjs.ModeOfOperation.cbc(data.key, data.iv);
        var decryptedData = aesCbc.decrypt(data.cipher);
        var decryptedBytes = aesjs.padding.pkcs7.strip(decryptedData);

        self.postMessage(decryptedBytes);
    } catch(e){
        throw e;
    }
}, false);
