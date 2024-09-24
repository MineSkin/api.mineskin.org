import * as colors from "./colors";
import { debug } from "./colors";
import * as fs from "fs";
import { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { Generator } from "../generator/Generator";
import { imageSize } from "image-size";
import * as fileType from "file-type";
import readChunk from "read-chunk";
import * as crypto from "crypto";
import { Caching } from "../generator/Caching";
import { MineSkinMetrics } from "./metrics";
import { MineSkinRequest } from "../typings";
import { imageHash } from "@inventivetalent/imghash";
import { ClientInfo } from "../typings/ClientInfo";
import UAParser from "ua-parser-js";
import { getRedisNextRequest, updateRedisNextRequest } from "../database/redis";
import { logger } from "./log";
import { IApiKeyDocument, ISkinDocument, SkinModel } from "@mineskin/database";
import { MineSkinError, SkinVariant } from "@mineskin/types";
import { TempFile } from "../generator/Temp";

export function resolveHostname() {
    if (process.env.NODE_HOSTNAME && !process.env.NODE_HOSTNAME.startsWith("{{")) {
        // docker swarm
        console.log("Using NODE_HOSTNAME: " + process.env.NODE_HOSTNAME);
        return process.env.NODE_HOSTNAME;
    }
    if (process.env.HOST_HOSTNAME) {
        console.log("Using HOST_HOSTNAME: " + process.env.HOST_HOSTNAME);
        return process.env.HOST_HOSTNAME;
    }
    if (process.env.HOSTNAME) {
        console.log("Using HOSTNAME: " + process.env.HOSTNAME);
        return process.env.HOSTNAME;
    }
    console.warn("Could not resolve hostname");
    return "unknown";
}

export function getIp(req: Request): string {
    return req.get('cf-connecting-ip') || req.get('x-forwarded-for') || req.get("x-real-ip") || req.connection.remoteAddress || req.ip || "unknown"
}

export async function checkTraffic(client: ClientInfo, req: Request, res: Response): Promise<boolean> {
    return await Sentry.startSpan({
        op: "generate_checkTraffic",
        name: "checkTraffic"
    }, async (span) => {
        const ip = getIp(req);
        console.log(debug("IP: " + ip));

        Sentry.setUser({
            ip_address: ip,
            username: `${ simplifyUserAgent(req.headers["user-agent"]!).ua }`
        });

        const apiKey = await getAndValidateRequestApiKey(req);
        if (apiKey) {
            Sentry.setUser({
                username: `${ apiKey.id.substr(0, 16) } ${ apiKey.name }`,
                ip_address: ip
            });
        }

        const nextRequest = await getRedisNextRequest(client);

        if (!nextRequest) { // first request
            return true;
        }

        if (nextRequest > client.time) {
            const delayInfo = await Generator.getDelay(apiKey);

            res.status(429).json({
                error: "Too many requests",
                limiter: "redis",
                nextRequest: Math.round(nextRequest / 1000), // deprecated
                delay: delayInfo.seconds, // deprecated

                delayInfo: {
                    seconds: delayInfo.seconds,
                    millis: delayInfo.millis
                },
                now: client.time
            });
            logger.warn(`${ client.userAgent.ua } Request too soon (${ nextRequest } > ${ client.time } = ${ nextRequest - client.time })`);
            MineSkinMetrics.get().then(metrics => {
                metrics.rateLimit
                    .tag("server", metrics.config.server)
                    .tag("limiter", "redis")
                    .tag("ua", client.userAgent.ua)
                    .inc();
            })
            return false;
        }

        /*
        const lastRequest = apiKey ? await Caching.getTrafficRequestTimeByApiKey(apiKey) : await Caching.getTrafficRequestTimeByIp(ip);
        if (!lastRequest) { // First request
            return true;
        }


        if (lastRequest.getTime() > time - delayInfo.millis) {
            res.status(429).json({
                error: "Too many requests",
                limiter: "mongo",
                nextRequest: Math.round((time / 1000) + delayInfo.seconds + 5), // deprecated
                delay: delayInfo.seconds, // deprecated

                delayInfo: {
                    seconds: delayInfo.seconds,
                    millis: delayInfo.millis
                },

                lastRequest: {
                    time: lastRequest.getTime()
                },
                now: time
            });
            console.log(debug("Request too soon"));
            MineSkinMetrics.get().then(metrics => {
                metrics.rateLimit
                    .tag("server", metrics.config.server)
                    .tag("limiter", "mongo")
                    .inc();
            })
            return false;
        }*/
        return true;
    })
}

export async function updateTraffic(client: ClientInfo, time: Date = new Date()): Promise<void> {
    return await Sentry.startSpan({
        op: "generate_updateTraffic",
        name: "updateTraffic",
    }, async span => {
        const ip = client.ip;
        const key = 'apiKeyId' in client ? client.apiKeyId : null;
        try {
            if (client.delayInfo) {
                updateRedisNextRequest(client, client.delayInfo.millis).catch(e => {
                    console.error(e);
                    Sentry.captureException(e);
                });
            }
        } catch (e) {
            console.error(e);
            Sentry.captureException(e);
        }
        return await Caching.updateTrafficRequestTime(ip, key || null, time);
    })
}


/**@deprecated**/
export async function getAndValidateRequestApiKey(req: MineSkinRequest): Promise<Maybe<IApiKeyDocument>> {
    let keyStr;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        keyStr = authHeader.substr("Bearer ".length);
    }
    const authQuery = req.query["key"];
    if (authQuery) {
        keyStr = authQuery as string
    }

    if (keyStr) {
        req.apiKeyStr = keyStr;

        const key = await Caching.getApiKey(Caching.cachedSha512(keyStr));
        if (!key) {
            throw new MineSkinError("invalid_api_key", "Invalid API Key", {httpCode:403});
        }

        key.updateLastUsed(new Date()); // don't await, don't really care

        req.apiKey = key;

        // Either a server IP or a client origin, not both
        if (key.allowedIps && key.allowedIps.length > 0) {
            const ip = getIp(req);
            if (!ip || key.allowedIps.includes(ip.trim())) {
                console.log(debug(`Client ${ ip } not allowed`));
                throw new MineSkinError("invalid_api_key", "Client not allowed", {httpCode:403});
            }
        } else if (key.allowedOrigins && key.allowedOrigins.length > 0) {
            const origin = req.headers.origin;
            if (!origin || !key.allowedOrigins.includes(origin.trim().toLowerCase())) {
                console.log(debug(`Origin ${ origin } not allowed`));
                throw new MineSkinError("invalid_api_key", "Origin not allowed", {httpCode:403});
            }
        }

        if (key.allowedAgents && key.allowedAgents.length > 0) {
            const agent = req.headers["user-agent"];
            if (!agent || !key.allowedAgents.includes(agent.trim().toLowerCase())) {
                console.log(debug(`Agent ${ agent } not allowed`));
                throw new MineSkinError("invalid_api_key", "Agent not allowed", {httpCode:403});
            }
        }

        return key;
    }

    return undefined;
}


export async function validateImage(req: Request, res: Response, file: string): Promise<boolean> {
    const stats = fs.statSync(file);
    const size = stats.size;
    if (size <= 0 || size > 16000) {
        res.status(400).json({error: "Invalid file size (" + size + ")"});
        return false;
    }

    try {
        const dimensions = imageSize(file);
        console.log(colors.debug("Dimensions: " + JSON.stringify(dimensions)));
        if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
            res.status(400).json({error: "Invalid skin dimensions. Must be 64x32 or 64x64. (Were " + dimensions.width + "x" + dimensions.height + ")"});
            return false;
        }
    } catch (e) {
        console.log(e)
        res.status(500).json({error: "Failed to get image dimensions", err: e});
        Sentry.captureException(e);
        return false;
    }

    const imageBuffer = await readChunk(file, 0, 4100);
    const type = await fileType.fromBuffer(imageBuffer);
    if (!type || type.ext !== "png" || type.mime !== "image/png") {
        res.status(400).json({error: "Invalid image type. Must be PNG. (Is " + type?.ext + " / " + type?.mime + ")"});
        return false;
    }

    return true;
}

export function modelToVariant(model?: string): SkinVariant {
    if (!model) {
        return SkinVariant.CLASSIC;
    }
    if (model === "slim" || model === "alex") {
        return SkinVariant.SLIM;
    }
    return SkinVariant.CLASSIC;
}

export function variantToModel(variant?: string): SkinModel {
    if (!variant) {
        return SkinModel.CLASSIC;
    }
    if (variant === "slim" || variant === "alex") {
        return SkinModel.SLIM;
    }
    return SkinModel.CLASSIC;
}

export function getVariant(skin: ISkinDocument) {
    if (skin.variant && skin.variant !== SkinVariant.UNKNOWN) {
        return skin.variant;
    }
    if ("model" in skin && skin.model && skin.model !== SkinModel.UNKNOWN) {
        return skin.variant = modelToVariant("model" in skin ? skin.model : "unknown");
    }
    return SkinVariant.UNKNOWN;
}

// https://coderwall.com/p/_g3x9q/how-to-check-if-javascript-object-is-empty
export function isEmpty(obj: any): boolean {
    for (let key in obj) {
        if (obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

export function stripUuid(uuid: string): string {
    return uuid.replace(/-/g, "");
}

export function addDashesToUuid(uuid: string): string {
    if (uuid.length >= 36) return uuid; // probably already has dashes
    return uuid.substr(0, 8) + "-" + uuid.substr(8, 4) + "-" + uuid.substr(12, 4) + "-" + uuid.substr(16, 4) + "-" + uuid.substr(20);
}

export function longAndShortUuid(str: string): Maybe<{ short: string, long: string }> {
    if (str.length < 32) {
        return undefined; // not an uuid
    }
    const short = stripUuid(str);
    const long = validateUuid(addDashesToUuid(short));
    if (!long) return undefined;
    return {
        long,
        short
    };
}

export function getVia(req: Request): string {
    let via = "api";
    if (req.headers["referer"]) {
        via = "other";
        if (req.headers["referer"].indexOf("mineskin.org") > -1) {
            via = "website";
            if (req.headers["referer"].indexOf("bulk") > -1) {
                via = "website-bulk";
            }
        }
    }
    return via;
}

export function md5(str: string): string {
    return crypto.createHash('md5').update(str).digest("hex");
}

export function sha1(str: string): string {
    return crypto.createHash('sha1').update(str).digest("hex");
}

export function sha256(str: string): string {
    return crypto.createHash('sha256').update(str).digest("hex");
}

export function sha512(str: string): string {
    return crypto.createHash('sha512').update(str).digest("hex");
}

export function base64encode(str: string): string {
    return Buffer.from(str).toString("base64");
}

export function base64decode(str: string): string {
    return Buffer.from(str, "base64").toString("ascii");
}

export function getHashFromMojangTextureUrl(url: string): Maybe<string> {
    const res = /textures\.minecraft\.net\/texture\/([0-9a-z]+)/i.exec(url);
    if (!res || res.length <= 1) return undefined;
    return res[1];
}

// https://stackoverflow.com/a/55585593/6257838
export function validateUrl(url: string): Maybe<string> {
    try {
        return new URL(url).href;
    } catch (e) {
    }
    return undefined;
}

export function validateUuid(uuidWithDashes: string): Maybe<string> {
    try {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuidWithDashes)) {
            return uuidWithDashes;
        }
    } catch (e) {
    }
    return undefined;
}

export function sleep(duration: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), duration);
    });
}

export function timeout<U>(promise: Promise<U>, t: number, tag?: Maybe<string>): Promise<U> {
    return new Promise<U>((resolve, reject) => {
        let start = Date.now();
        let timedOut = false;
        const err = new TimeoutError(`Promise timed out after ${ t }ms`, tag);
        let timer = setTimeout(() => {
            timedOut = true;
            reject(err);
        }, t);

        promise
            .then(v => {
                if (timedOut) {
                    console.log(`timed out succeeded after ${ Date.now() - start }ms: ${ tag || '' }`)
                    return;
                }
                clearTimeout(timer);
                resolve(v);
            })
            .catch(e => {
                Sentry.captureException(e, {
                    tags: {
                        timeoutTag: tag
                    }
                });
                if (timedOut) {
                    console.log(`timed out errored after ${ Date.now() - start }ms: ${ tag || '' }`)
                    return;
                }
                clearTimeout(timer);
                reject(e);
            })
    })
}

export function timeoutWrap<T extends Array<any>, U>(func: (...args: T) => Promise<U>, t: number): (...args: T) => Promise<U> {
    return (...args: T): Promise<U> => {
        return new Promise<U>((resolve, reject) => {
            let timedOut = false;
            const err = new Error(`Promise timed out after ${ t }ms`);
            let timer = setTimeout(() => {
                timedOut = true;
                reject(err);
            }, t);

            func(...args)
                .then(v => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    resolve(v);
                })
                .catch(e => {
                    Sentry.captureException(e);
                    if (timedOut) return;
                    clearTimeout(timer);
                    reject(e);
                })
        })
    }
}

export class TimeoutError extends MineSkinError {
    constructor(msg: string, public tag: Maybe<string>) {
        super('timeout', msg);
        Object.setPrototypeOf(this, TimeoutError.prototype);
    }

    get name(): string {
        return 'TimeoutError';
    }
}

export const POW_2_32 = Math.pow(2, 32);

export function random32BitNumber(): Promise<number> {
    return new Promise((resolve, reject) => {
        crypto.randomInt(POW_2_32, (err, val) => {
            if (err) {
                reject(err);
            } else {
                resolve(val);
            }
        });
    });
}

export async function imgHash(buffer: Buffer): Promise<string> {
    return imageHash(buffer, {algorithm: "sha1"})
}

export function stripNumbers(str?: string): string {
    if (!str) return "?";
    return str.replace(/\d/g, "x");
}

// https://fettblog.eu/typescript-hasownproperty/
export function hasOwnProperty<X extends {}, Y extends PropertyKey>(obj: X, prop: Y): obj is X & Record<Y, unknown> {
    return obj.hasOwnProperty(prop)
}

export function epochSeconds(): number {
    return toEpochSeconds(Date.now());
}

export function toEpochSeconds(timestamp: number): number {
    return Math.floor(timestamp / 1000);
}

// https://github.com/microsoft/TypeScript/issues/13321#issuecomment-637120710
export type Maybe<T> = T | undefined;

export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
export const ONE_MONTH_SECONDS = 60 * 60 * 24 * 30;
export const ONE_DAY_SECONDS = 60 * 60 * 24;

export function simplifyUserAgent(ua: string): SimplifiedUserAgent {
    const result = UAParser(ua);
    if (result.browser && result.browser.name) {
        return {generic: true, ua: result.browser.name, original: ua};
    }
    if (result.device && result.device.type) {
        return {generic: true, ua: result.device.type, original: ua};
    }
    if (result.os && result.os.name) {
        return {generic: true, ua: result.os.name, original: ua};
    }
    const stripped = result.ua
        .replace(/\/v?(\d\.?)+/g, '')
        .replace(/\ \(.+/, '')
        .replace(/\d/g, "x")
        .replace(/[^a-zA-Z\/\-_]/g, '');

    return {generic: false, ua: stripped, original: ua};
}

export type SimplifiedUserAgent = { generic: boolean; ua: string; original: string; };

export type PathHolder = { path: string; }

export function isTempFile(obj: any): obj is TempFile {
    return obj && 'path' in obj && 'fd' in obj && 'remove' in obj;
}

export const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Accept, Content-Type, Origin");
    res.header("Access-Control-Request-Headers", "X-Requested-With, Accept, Content-Type, Origin");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    } else {
        return next();
    }
};
export const corsWithAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Accept, Content-Type, Origin, Authorization, Cookie");
    res.header("Access-Control-Request-Headers", "X-Requested-With, Accept, Content-Type, Origin, Authorization, Cookie");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    } else {
        return next();
    }
};
export const corsWithCredentialsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', 'https://mineskin.org');
    if (req.headers.origin === "https://testing.mineskin.org") {
        res.header('Access-Control-Allow-Origin', 'https://testing.mineskin.org');
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Accept, Content-Type, Origin, Authorization, Cookie");
    res.header("Access-Control-Request-Headers", "X-Requested-With, Accept, Content-Type, Origin, Authorization, Cookie");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    } else {
        return next();
    }
};
