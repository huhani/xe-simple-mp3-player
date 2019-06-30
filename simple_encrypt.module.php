<?php

if(!function_exists('hash_equals')) {
    function hash_equals($str1, $str2) {
        if(strlen($str1) != strlen($str2)) {
            return false;
        } else {
            $res = $str1 ^ $str2;
            $ret = 0;
            for($i = strlen($res) - 1; $i >= 0; $i--) {
                $ret |= ord($res[$i]);
            }

            return !$ret;
        }
    }
}

class SimpleEncrypt {

    public static function isEncryptSupported() {
        $functions = array('openssl_cipher_iv_length');
        foreach($functions as $eachFunction) {
            if(!function_exists($eachFunction)) {
                return false;
            }
        }

        return true;
    }

    public static function getEncrypt($plaintext, $key) {
        $ivlen = openssl_cipher_iv_length($cipher="AES-128-CBC");
        $iv = openssl_random_pseudo_bytes($ivlen);
        $ciphertext_raw = openssl_encrypt($plaintext, $cipher, $key, $options=OPENSSL_RAW_DATA, $iv);
        $hmac = hash_hmac('sha256', $ciphertext_raw, $key, $as_binary=true);
        $ciphertext = base64_encode( $iv.$hmac.$ciphertext_raw );

        return $ciphertext;
    }

    public static function getDecrypt($ciphertext, $key) {
        $c = base64_decode($ciphertext);
        $ivlen = openssl_cipher_iv_length($cipher="AES-128-CBC");
        $iv = substr($c, 0, $ivlen);
        $hmac = substr($c, $ivlen, $sha2len=32);
        $ciphertext_raw = substr($c, $ivlen+$sha2len);
        $original_plaintext = openssl_decrypt($ciphertext_raw, $cipher, $key, $options=OPENSSL_RAW_DATA, $iv);
        $calcmac = hash_hmac('sha256', $ciphertext_raw, $key, $as_binary=true);
        //PHP 5.6+ timing attack safe comparison
        if (hash_equals($hmac, $calcmac)) {
            return $original_plaintext;
        }

        return null;
    }

    private static function savePassword($password) {
        file_put_contents(self::getPathname().'__password.php', '<?php exit(); /*'.$password.'*/');
    }

    private static function getRandomStr() {
        $chrs = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $chrsLen = strlen($chrs);
        $randomString = '';
        for ($i = 0; $i < 8; $i++) {
            $randomString .= $chrs[rand(0, $chrsLen - 1)];
        }

        return $randomString;
    }

    private static function getPathname() {
        $file_server_path = realpath(__FILE__);
        return str_replace(basename(__FILE__), "", $file_server_path);
    }

    public static function buildNewPassword() {
        $password = self::getRandomStr();
        self::savePassword($password);
        if(self::getPassword() !== null) {
            return $password;
        }

        return null;
    }

    public static function getPassword() {
        $filepath = self::getPathname().'__password.php';
        $regex = '/\<\?php\sexit\(\)\;\s\/\*(.*)\*\//';
        if(file_exists($filepath)) {
            $password = file_get_contents($filepath);
            if($password) {
                preg_match_all($regex, $password, $result);
                if($result && isset($result[1]) && $result[1]) {
                    return $result[1][0];
                }
            }
        }

        return null;
    }

}