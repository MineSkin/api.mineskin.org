import * as crypto from "crypto";
import { Config } from "../types/Config";

const config: Config = require("../config");

// https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb

const ENCRYPTION_KEY = config.crypto.key; // Must be 256 bytes (32 characters)
const IV_LENGTH = 16; // For AES, this is always 16

export class Encryption {

    static encrypt(text: string): string {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(config.crypto.algorithm, new Buffer(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text);

        encrypted = Buffer.concat([encrypted, cipher.final()]);

        return new Buffer(iv.toString('hex') + ':' + encrypted.toString('hex')).toString('base64')
    }


    static decrypt(text: string): string {
        const textParts = new Buffer(text, 'base64').toString('ascii').split(':');
        const iv = new Buffer(textParts.shift() as string, 'hex');
        const encryptedText = new Buffer(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(config.crypto.algorithm, new Buffer(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);

        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString();
    }

}
