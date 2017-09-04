// https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb
'use strict';

var crypto = require('crypto');
var config = require("./config");

var ENCRYPTION_KEY = config.crypto.key; // Must be 256 bytes (32 characters)
var IV_LENGTH = 16; // For AES, this is always 16

module.exports.encrypt = function (text) {
    var iv = crypto.randomBytes(IV_LENGTH);
    var cipher = crypto.createCipheriv(config.crypto.algorithm, new Buffer(ENCRYPTION_KEY), iv);
    var encrypted = cipher.update(text);

    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return new Buffer(iv.toString('hex') + ':' + encrypted.toString('hex')).toString('base64')
}

module.exports.decrypt = function (text) {
    var textParts = new Buffer(text, 'base64').toString('ascii').split(':');
    var iv = new Buffer(textParts.shift(), 'hex');
    var encryptedText = new Buffer(textParts.join(':'), 'hex');
    var decipher = crypto.createDecipheriv(config.crypto.algorithm, new Buffer(ENCRYPTION_KEY), iv);
    var decrypted = decipher.update(encryptedText);

    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
}
