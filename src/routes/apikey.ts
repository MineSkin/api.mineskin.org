import { Application, Request, Response } from "express";
import { base64encode, corsWithCredentialsMiddleware, random32BitNumber, sha256, sha512 } from "../util";
import { debug, info } from "../util/colors";
import { Caching } from "../generator/Caching";
import { getConfig } from "../typings/Configs";
import { Discord } from "../util/Discord";
import { getUserFromRequest } from "./account";
import { ApiKey, IApiKeyDocument } from "@mineskin/database";


export const register = (app: Application) => {

    app.use("/apikey", corsWithCredentialsMiddleware);

    app.get("/apikey", async (req: Request, res: Response) => {
        const key: string = req.query["key"] as string;
        if (!key) {
            res.status(400).json({ error: "missing key" });
            return;
        }

        const apiKey = await ApiKey.findByKeyHash(Caching.cachedSha512(key));
        if (!apiKey) {
            res.status(400).json({ error: "invalid key" });
            return;
        }

        const config = await getConfig();

        res.json({
            success: true,
            server: config.server,
            name: apiKey.name,
            owner: apiKey.owner,
            key: key,
            createdAt: apiKey.createdAt,
            origins: apiKey.allowedOrigins,
            ips: apiKey.allowedIps,
            agents: apiKey.allowedAgents,
            minDelay: await apiKey.getMinDelay()
        })
    })

    app.post("/apikey", async (req: Request, res: Response) => {
        const name: string = req.body["name"];
        if (!name) {
            res.status(400).json({ error: "missing name" });
            return;
        }

        const user = await getUserFromRequest(req, res, false);

        if (!user) {
            res.status(400).json({ error: "invalid user" });
            return;
        }

        const config = await getConfig();

        const allowedOrigins: string[] = (req.body["origins"] || []).map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 7 && s.length < 30);
        const allowedIps: string[] = (req.body["ips"] || []).map((s: string) => s.trim()).filter((s: string) => s.length > 7 && s.length < 40);
        const allowedAgents: string[] = (req.body["agents"] || []).map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 5 && s.length < 30);

        console.log(info(`Generating new API Key "${ name }" for ${ user.uuid}`));
        console.log(debug(`Origins: ${ allowedOrigins }`));
        console.log(debug(`IPs:     ${ allowedIps }`));
        console.log(debug(`Agents:  ${ allowedAgents }`));

        const key: string = sha256(`${ Math.random() * Math.random() }%${ await random32BitNumber() }%${ Date.now() }`);
        const secret: string = sha512(`${ Math.random() }$$${ await random32BitNumber() }$$${ Math.random() * Math.random() }$${ base64encode(key) }$$${ Date.now() * Math.random() }`);

        const date = new Date();

        const keyHash: string = Caching.cachedSha512(key);
        const secretHash: string = Caching.cachedSha512(secret);

        console.log(debug(`Key:     ${ keyHash }`));

        //TODO: grant lower delay to owners with linked MC accounts

        const apiKey: IApiKeyDocument = new ApiKey(<IApiKeyDocument>{
            name: name.substr(0, 64),
            key: keyHash,
            secret: secretHash,
            createdAt: date,
            updatedAt: date,
            allowedOrigins: allowedOrigins,
            allowedIps: allowedIps,
            allowedAgents: allowedAgents
        });
        if (user && user.uuid) {
            apiKey.user = user.uuid;
        }

        await apiKey.save();

        Discord.postDiscordMessage("🔑 New API Key created\n" +
            "Name:      " + apiKey.name + "\n" +
            "User:      " + apiKey.user + "\n" +
            "Origins:   " + apiKey.allowedOrigins + "\n" +
            "IPs:       " + apiKey.allowedIps + "\n" +
            "Agents:    " + apiKey.allowedAgents + "\n");

        res.json({
            success: true,
            msg: "key created - make sure to save it!",
            name: apiKey.name,
            user: apiKey.user,
            key: key,
            secret: secret,
            createdAt: apiKey.createdAt,
            origins: apiKey.allowedOrigins,
            ips: apiKey.allowedIps,
            agents: apiKey.allowedAgents,
            minDelay: await apiKey.getMinDelay()
        })
    });


    app.put("/apikey", async (req: Request, res: Response) => {
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

        const apiKey = await ApiKey.findByKeyHash(Caching.cachedSha512(key));
        if (!apiKey) {
            res.status(400).json({ error: "invalid key" });
            return;
        }

        if (apiKey.secret !== Caching.cachedSha512(secret)) {
            res.status(400).json({ error: "invalid secret" });
            return;
        }

        const user = await getUserFromRequest(req, res, false);

        const name: string = req.body["name"];
        if (name) {
            apiKey.name = name.substr(0, 64);
        }
        const allowedOrigins: string[] = req.body["origins"];
        if (allowedOrigins) {
            apiKey.allowedOrigins = allowedOrigins.map(s => s.trim().toLowerCase()).filter(s => s.length > 7 && s.length < 30);
        }
        const allowedIps: string[] = req.body["ips"];
        if (allowedIps) {
            apiKey.allowedIps = allowedIps.map(s => s.trim()).filter(s => s.length > 7 && s.length < 40);
        }
        const allowedAgents: string[] = req.body["agents"];
        if (allowedAgents) {
            apiKey.allowedAgents = allowedAgents.map(s => s.trim().toLowerCase()).filter(s => s.length > 5 && s.length < 30);
        }

        if (user && user.uuid) {
            if (!apiKey.user) {
                apiKey.user = user.uuid;
            }
        }

        apiKey.updatedAt = new Date();

        await apiKey.save();

        Discord.postDiscordMessage("🔑 API Key updated\n" +
            "Name:      " + apiKey.name + "\n" +
            "User:      " + apiKey.user + "\n" +
            "Origins:   " + apiKey.allowedOrigins + "\n" +
            "IPs:       " + apiKey.allowedIps + "\n" +
            "Agents:    " + apiKey.allowedAgents + "\n");

        res.json({
            success: true,
            msg: "key updated"
        })
    });


    app.delete("/apikey", async (req: Request, res: Response) => {
        console.log(req.body)
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

        const apiKey = await ApiKey.findByKeyHash(Caching.cachedSha512(key));
        if (!apiKey) {
            res.status(400).json({ error: "invalid key" });
            return;
        }

        if (apiKey.secret !== Caching.cachedSha512(secret)) {
            res.status(400).json({ error: "invalid secret" });
            return;
        }

        await apiKey.deleteOne();

        Discord.postDiscordMessage("🔑 API Key deleted\n" +
            "Name:      " + apiKey.name + "\n" +
            "User:      " + apiKey.user + "\n" +
            "Origins:   " + apiKey.allowedOrigins + "\n" +
            "IPs:       " + apiKey.allowedIps + "\n" +
            "Agents:    " + apiKey.allowedAgents + "\n");

        res.json({
            success: true,
            msg: "key deleted"
        })
    });

}
