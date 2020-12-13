// https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb
'use strict';

const crypto = require('crypto');
const config = require("./config");

const ENCRYPTION_KEY = config.crypto.key; // Must be 256 bytes (32 characters)
const IV_LENGTH = 16; // For AES, this is always 16

module.exports.encrypt = function (text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(config.crypto.algorithm, new Buffer(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);

    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return new Buffer(iv.toString('hex') + ':' + encrypted.toString('hex')).toString('base64')
}

module.exports.decrypt = function (text) {
    const textParts = new Buffer(text, 'base64').toString('ascii').split(':');
    const iv = new Buffer(textParts.shift(), 'hex');
    const encryptedText = new Buffer(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(config.crypto.algorithm, new Buffer(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);

    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
}
