import * as crypto from "crypto";
import { getConfig } from "../typings/Configs";

// https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb

const IV_LENGTH = 16; // For AES, this is always 16

export class Encryption {

    static async encrypt(text: string): Promise<string> {
        const config = await getConfig();
        const ENCRYPTION_KEY = config.crypto.key; // Must be 256 bytes (32 characters)

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(config.crypto.algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text);

        encrypted = Buffer.concat([encrypted, cipher.final()]);

        return Buffer.from(iv.toString('hex') + ':' + encrypted.toString('hex')).toString('base64')
    }


    static async decrypt(text: string): Promise<string> {
        const config = await getConfig();
        const ENCRYPTION_KEY = config.crypto.key; // Must be 256 bytes (32 characters)

        const textParts = Buffer.from(text, 'base64').toString('ascii').split(':');
        const iv = Buffer.from(textParts.shift() as string, 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(config.crypto.algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);

        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString();
    }

}
