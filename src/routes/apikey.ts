import { Application, Request, Response } from "express";
import { base64encode, random32BitNumber, sha256, sha512 } from "../util";
import { debug, info } from "../util/colors";
import { Caching } from "../generator/Caching";
import { IApiKeyDocument } from "../typings/db/IApiKeyDocument";
import { ApiKey } from "../database/schemas/ApiKey";
import { DEFAULT_DELAY } from "../generator/Generator";

export const register = (app: Application) => {

    // no cors middleware here, want to restrict it to mineskin.org only

    app.post("/apikey/create", async (req: Request, res: Response) => {
        const name: string = req.body["name"];
        if (!name) {
            res.status(400).json({ error: "missing name" });
            return;
        }
        const owner: string = req.body["owner"];
        if (!owner) {
            res.status(400).json({ error: "missing owner" });
            return;
        }

        const allowedOrigins: string[] = req.body["origins"] || [];
        const allowedIps: string[] = req.body["ips"] || [];
        const allowedAgents: string[] = req.body["agents"] || [];

        console.log(info(`Generating new API Key "${ name }" for ${ owner }`));
        console.log(debug(`Origins: ${ allowedOrigins }`));
        console.log(debug(`IPs:     ${ allowedIps }`));
        console.log(debug(`Agents:  ${ allowedAgents }`));

        const key: string = sha256(`${ Math.random() * Math.random() }%${ await random32BitNumber() }%${ Date.now() }`);
        const secret: string = sha512(`${ Math.random() }$$${ await random32BitNumber() }$$${ Math.random() * Math.random() }$${ base64encode(key) }$$${ Date.now() * Math.random() }`);

        const date = new Date();

        const keyHash: string = Caching.cachedSha512(key);
        const secretHash: string = Caching.cachedSha512(secret);

        console.log(debug(`Key:     ${ keyHash }`));

        const apiKey: IApiKeyDocument = new ApiKey(<IApiKeyDocument>{
            name: name,
            owner: owner,
            key: keyHash,
            secret: secretHash,
            createdAt: date,
            allowedOrigins: allowedOrigins,
            allowedIps: allowedIps,
            allowedAgents: allowedAgents,
            minDelay: DEFAULT_DELAY
        });

        await apiKey.save();

        res.json({
            success: true,
            msg: "key created",
            name: apiKey.name,
            owner: apiKey.owner,
            key: key,
            secret: secret,
            createdAt: apiKey.createdAt,
            origins: apiKey.allowedOrigins,
            ips: apiKey.allowedIps,
            agents: apiKey.allowedAgents,
            minDelay: apiKey.minDelay
        })
    });


    app.put("/apikey/update", async (req: Request, res: Response) => {
        const key: string = req.body["key"];
        if (!key) {
            res.status(400).json({ error: "missing key" });
            return;
        }
        const secret: string = req.body["secret"];
        if (!secret) {
            res.status(400).json({ error: "missing secret" });
            return;
        }

        const apiKey = await ApiKey.findKey(Caching.cachedSha512(key));
        if (!apiKey) {
            res.status(400).json({ error: "invalid key" });
            return;
        }

        if (apiKey.secret !== Caching.cachedSha512(secret)) {
            res.status(400).json({ error: "invalid secret" });
            return;
        }

        const name: string = req.body["name"];
        if (name) {
            apiKey.name = name;
        }
        const allowedOrigins: string[] = req.body["origins"];
        if (allowedOrigins) {
            apiKey.allowedOrigins = allowedOrigins;
        }
        const allowedIps: string[] = req.body["ips"];
        if (allowedIps) {
            apiKey.allowedIps = allowedIps;
        }
        const allowedAgents: string[] = req.body["agents"];
        if (allowedAgents) {
            apiKey.allowedAgents = allowedAgents;
        }


        await apiKey.save();

        res.json({
            success: true,
            msg: "key updated"
        })
    });


    app.delete("/apikey/delete", async (req: Request, res: Response) => {
        const key: string = req.body["key"];
        if (!key) {
            res.status(400).json({ error: "missing key" });
            return;
        }
        const secret: string = req.body["secret"];
        if (!secret) {
            res.status(400).json({ error: "missing secret" });
            return;
        }

        const apiKey = await ApiKey.findKey(Caching.cachedSha512(key));
        if (!apiKey) {
            res.status(400).json({ error: "invalid key" });
            return;
        }

        if (apiKey.secret !== Caching.cachedSha512(secret)) {
            res.status(400).json({ error: "invalid secret" });
            return;
        }

        await apiKey.delete();

        res.json({
            success: true,
            msg: "key deleted"
        })
    });


}
