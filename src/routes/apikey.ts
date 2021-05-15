import { Application, Request, Response } from "express";
import { base64encode, corsMiddleware, corsWithAuthMiddleware, corsWithCredentialsMiddleware, Maybe, random32BitNumber, sha256, sha512 } from "../util";
import { debug, info, warn } from "../util/colors";
import { Caching } from "../generator/Caching";
import { IApiKeyDocument } from "../typings/db/IApiKeyDocument";
import { ApiKey } from "../database/schemas/ApiKey";
import { DEFAULT_DELAY } from "../generator/Generator";
import { Account } from "../database/schemas";
import { Requests } from "../generator/Requests";
import { Discord } from "../util/Discord";
import { getConfig } from "../typings/Configs";
import { PendingDiscordApiKeyLink } from "../typings/DiscordAccountLink";
import * as qs from "querystring";

const config = getConfig();

const DEFAULT_API_KEY_DELAY = 4;

export const register = (app: Application) => {

    app.use("/apikey", corsWithCredentialsMiddleware);

    app.get("/apikey", async (req: Request, res: Response) => {
        const key: string = req.query["key"] as string;
        if (!key) {
            res.status(400).json({ error: "missing key" });
            return;
        }

        const apiKey = await ApiKey.findKey(Caching.cachedSha512(key));
        if (!apiKey) {
            res.status(400).json({ error: "invalid key" });
            return;
        }

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
            minDelay: apiKey.minDelay
        })
    })

    app.post("/apikey", async (req: Request, res: Response) => {
        const name: string = req.body["name"];
        if (!name) {
            res.status(400).json({ error: "missing name" });
            return;
        }
        const ownerState: string = req.body["owner"];
        if (!ownerState) {
            res.status(400).json({ error: "missing owner" });
            return;
        }

        const owner = (Caching.getPendingDiscordLink(ownerState) as Maybe<PendingDiscordApiKeyLink>)?.user;
        if (!owner) {
            res.status(400).json({ error: "invalid owner" });
            return;
        }
        Caching.invalidatePendingDiscordLink(ownerState);

        const allowedOrigins: string[] = (req.body["origins"] || []).map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 7 && s.length < 30);
        const allowedIps: string[] = (req.body["ips"] || []).map((s: string) => s.trim()).filter((s: string) => s.length > 7 && s.length < 40);
        const allowedAgents: string[] = (req.body["agents"] || []).map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 5 && s.length < 30);

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

        //TODO: grant lower delay to owners with linked MC accounts

        const apiKey: IApiKeyDocument = new ApiKey(<IApiKeyDocument>{
            name: name.substr(0, 64),
            owner: owner,
            key: keyHash,
            secret: secretHash,
            createdAt: date,
            updatedAt: date,
            allowedOrigins: allowedOrigins,
            allowedIps: allowedIps,
            allowedAgents: allowedAgents,
            minDelay: DEFAULT_API_KEY_DELAY
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

        apiKey.updatedAt = new Date();


        await apiKey.save();

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


    app.get("/apikey/discord/oauth/start", async (req: Request, res: Response) => {
        if (!config.discordApiKey) {
            res.status(400).json({ error: "server can't handle discord auth" });
            return;
        }

        const clientId = config.discordApiKey.id;
        const redirect = encodeURIComponent(`https://${ config.server }.api.mineskin.org/apikey/discord/oauth/callback`);
        const state = sha256(`${ Date.now() }${ config.server }${ Math.random() }`);

        Caching.storePendingDiscordLink(<PendingDiscordApiKeyLink>{
            state: state
        });

        res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${ clientId }&scope=identify&response_type=code&state=${ state }&redirect_uri=${ redirect }`);
    })

    app.get("/apikey/discord/oauth/callback", async (req: Request, res: Response) => {
        if (!req.query["code"] || !req.query["state"]) {
            res.status(400).end();
            return;
        }
        if (!config.discordApiKey) {
            res.status(400).json({ error: "server can't handle discord auth" });
            return;
        }

        const pendingLink: Maybe<PendingDiscordApiKeyLink> = Caching.getPendingDiscordLink(req.query["state"] as string);
        if (!pendingLink) {
            console.warn("Got a discord OAuth callback but the API wasn't expecting that linking request");
            res.status(400).json({ error: "invalid state" });
            return;
        }
        Caching.invalidatePendingDiscordLink(req.query["state"] as string);

        const clientId = config.discordApiKey.id;
        const clientSecret = config.discordApiKey.secret;
        const redirect = `https://${ config.server }.api.mineskin.org/apikey/discord/oauth/callback`;

        // Exchange code for token
        const form: any = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code: req.query["code"],
            redirect_uri: redirect,
            scope: "identify"
        };
        const tokenResponse = await Requests.axiosInstance.request({
            method: "POST",
            url: "https://discordapp.com/api/oauth2/token",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "Accept-Encoding": "gzip"
            },
            data: qs.stringify(form)
        });
        const tokenBody = tokenResponse.data;
        const accessToken = tokenBody["access_token"];
        if (!accessToken) {
            console.warn("Failed to get access token from discord");
            res.status(500).json({ error: "Discord API error" });
            return;
        }

        // Get user profile
        const userResponse = await Requests.axiosInstance.request({
            method: "GET",
            url: "https://discordapp.com/api/users/@me",
            headers: {
                "Authorization": `Bearer ${ accessToken }`,
                "Accept": "application/json",
                "Accept-Encoding": "gzip"
            }
        });
        const userBody = userResponse.data;

        const discordId = userBody["id"];
        if (!discordId) {
            console.warn("Discord response did not have an id field")
            res.status(404).json({ error: "Discord API error" });
            return;
        }

        const state = sha256(`${ req.query["state"] }${ Date.now() }`);

        // use this as a temporary storage for the user id
        Caching.storePendingDiscordLink(<PendingDiscordApiKeyLink>{
            state: state,
            user: discordId
        });

        res.redirect(`https://mineskin.org/apikey?` + encodeURIComponent(base64encode(config.server + ":" + state)));
    })


}
