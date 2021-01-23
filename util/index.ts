import * as hasha from "hasha";

export * from "./colors";
export * from "./metrics";
export * from "./encryption";

import * as colors from "./colors";
import * as fs from "fs";
import { CallbackError } from "mongoose";
import { Request, Response } from "express";
import { Account, Skin, Traffic, Stat } from "../database/schemas";
import { Config } from "../types/Config";
import { ITrafficDocument } from "../types";
import * as Sentry from "@sentry/node";
import { Generator } from "../generator/Generator";
import { MemoizeExpiring } from "typescript-memoize";
import { imageSize } from "image-size";
import * as fileType from "file-type";
import * as readChunk from "read-chunk";
import * as crypto from "crypto";
import exp = require("constants");
import { Caching } from "../generator/Caching";

const config: Config = require("../config");

export function getIp(req: Request): string {
    return req.get('cf-connecting-ip') || req.get('x-forwarded-for') || req.get("x-real-ip") || req.connection.remoteAddress || req.ip;
}

export async function checkTraffic(req: Request, res: Response): Promise<boolean> {
    const ip = getIp(req);
    console.log(colors.debug("IP: " + ip));

    const lastRequest = await Caching.getTrafficRequestTimeByIp(ip);
    if (!lastRequest) { // First request
        return true;
    }
    const time = Date.now() / 1000;
    const delay = await Generator.getDelay();
    if ((lastRequest.getTime() / 1000) > time - delay) {
        res.status(429).json({ error: "Too many requests", nextRequest: time + delay + 10, delay: delay });
        return false;
    }
    return true;
}

export async function validateImage(req: Request, res: Response, file: string): Promise<boolean> {
    const stats = fs.statSync(file);
    const size = stats.size;
    if (size <= 0 || size > 16000) {
        res.status(400).json({ error: "Invalid file size (" + size + ")" });
        return false;
    }

    try {
        const dimensions = imageSize(file);
        console.log(colors.debug("Dimensions: " + JSON.stringify(dimensions)));
        if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
            res.status(400).json({ error: "Invalid skin dimensions. Must be 64x32 or 64x64. (Were " + dimensions.width + "x" + dimensions.height + ")" });
            return false;
        }
    } catch (e) {
        console.log(e)
        res.status(500).json({ error: "Failed to get image dimensions", err: e });
        Sentry.captureException(e);
        return false;
    }

    const imageBuffer = await readChunk(file, 0, 4100);
    const type = await fileType.fromBuffer(imageBuffer);
    if (!type || type.ext !== "png" || type.mime !== "image/png") {
        res.status(400).json({ error: "Invalid image type. Must be PNG. (Is " + type?.ext + " / " + type?.mime + ")" });
        return false;
    }

    return true;
}

// https://coderwall.com/p/_g3x9q/how-to-check-if-javascript-object-is-empty
export function isEmpty(obj: any): boolean {
    for (let key in obj) {
        if (obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

export function validateModel(model: string): string {
    if (!model) return model;
    model = model.toLowerCase();

    if (model === "default" || model === "steve" || model === "classic") {
        return "steve";
    }
    if (model === "slim" || model === "alex") {
        return "slim";
    }

    return model;
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
    return new Buffer(str).toString("base64");
}

export function base64decode(str: string): string {
    return new Buffer(str, "base64").toString("ascii");
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

export async function imageHash(buffer: Buffer) {
    return hasha.async(buffer, {
        algorithm: "sha1"
    })
}

// https://fettblog.eu/typescript-hasownproperty/
export function hasOwnProperty<X extends {}, Y extends PropertyKey>(obj: X, prop: Y): obj is X & Record<Y, unknown> {
    return obj.hasOwnProperty(prop)
}

// https://github.com/microsoft/TypeScript/issues/13321#issuecomment-637120710
export type Maybe<T> = T | undefined;
