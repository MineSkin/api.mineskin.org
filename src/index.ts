import "dotenv/config"
import "./instrument"
import "reflect-metadata";

import { httpLogger } from "./util/log";
import * as sourceMapSupport from "source-map-support";
import * as Sentry from "@sentry/node";
import express, { ErrorRequestHandler, Express, NextFunction, Request, Response } from "express";
import "express-async-errors";
import morgan from "morgan";
import * as bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import {
    accountManagerRoute,
    accountRoute,
    apiKeyRoute,
    generateRoute,
    getRoute,
    hiatusRoute,
    renderRoute,
    testerRoute,
    utilRoute,
    v2DelayRouter,
    v2GenerateRouter,
    v2ImagesRouter,
    v2MeRouter,
    v2QueueRouter,
    v2SkinsRouter
} from "./routes";
import { Temp } from "./generator/Temp";
import { getConfig, getLocalConfig, MineSkinConfig } from "./typings/Configs";
import { isBreadRequest } from "./typings";
import { MineSkinMetrics } from "./util/metrics";
import { corsMiddleware, getAndValidateRequestApiKey, resolveHostname, simplifyUserAgent } from "./util";
import { AuthenticationError } from "./generator/Authentication";
import { Generator } from "./generator/Generator";
import { GitConfig } from "@inventivetalent/gitconfig";
import { GithubWebhook } from "@inventivetalent/express-github-webhook/dist/src";
import { Stats } from "./generator/Stats";
import { Requests } from "./generator/Requests";
import { debug, info, warn } from "./util/colors";
import { Discord } from "./util/Discord";
import { Balancer } from "./generator/Balancer";
import UAParser from "ua-parser-js";
import mongoose from "mongoose";
import { connectToMongo } from "@mineskin/database";
import { MineSkinError } from "@mineskin/types";
import { FlagsmithProvider, GeneratorError, IFlagProvider, Log, RedisProvider } from "@mineskin/generator";
import process from "node:process";
import * as http from "node:http";
import { v2TestRouter } from "./routes/v2/test";
import { v2ErrorHandler, v2NotFoundHandler } from "./middleware/error";
import { container, instanceCachingFactory } from "tsyringe";
import { ApiLogProvider } from "./ApiLogProvider";
import { ApiAuditLogger } from "./ApiAuditLogger";


sourceMapSupport.install();

container.register("Log", {useClass: ApiLogProvider});
container.register("AuditLogger", {useClass: ApiAuditLogger});

let config: MineSkinConfig;
let port: number;

let updatingApp = true;

const hostname = resolveHostname();



Log.l.info("\n" +
    "  ==== STARTING UP ==== \n" +
    "" + process.env.NODE_ENV + "\n" +
    "" + process.env.SOURCE_COMMIT + "\n" +
    "" + hostname + "\n" +
    "\n");

// {
//     console.log("Initializing Sentry")
//     Sentry.init({
//         dsn: process.env.SENTRY_DSN,
//         release: process.env.SOURCE_COMMIT || "unknown",
//         integrations: [
//             nodeProfilingIntegration()
//         ],
//         serverName: hostname,
//         tracesSampleRate: 0.1,
//         sampleRate: 0.8,
//         ignoreErrors: [
//             "No duplicate found",
//             "Invalid image file size",
//             "Invalid image dimensions",
//             "Failed to find image from url",
//             "Invalid file size"
//         ]
//     });
//
//     // app.use(Sentry.Handlers.requestHandler());
//     // app.use(Sentry.Handlers.tracingHandler());
// }


let app: Express;
let server: http.Server;


async function init() {
    console.log("Node Version " + process.version);

    container.register("FlagProvider", {useFactory: instanceCachingFactory<IFlagProvider>(c => c.resolve(FlagsmithProvider))});
    container.register("RedisProvider", {useFactory: instanceCachingFactory<RedisProvider>(c => c.resolve(RedisProvider))});

    {// Config
        console.log("Setting up config");

        const localConfig = getLocalConfig();
        GitConfig.source = localConfig.gitconfig.base;
        GitConfig.local = localConfig.gitconfig.local;
        GitConfig.axiosInstance.defaults.headers["Accept"] = "application/vnd.github.v3.raw";
        GitConfig.axiosInstance.defaults.headers["Authorization"] = "token " + localConfig.gitconfig.token;

        config = await getConfig();

        if (hostname !== 'unknown') {
            config.server = hostname;
        }

        if (!config ||
            !config.requestServers ||
            !config.requestServers[config.server]
        ) {
            console.error(new Error("Invalid config"));
            requestShutdown('CONFIG_ERROR', 1);
        }

        Requests.init(config);
    }

    // const version = await gitsha();
    const version = process.env.SOURCE_COMMIT || "unknown";
    console.log(info("Version: " + version));
    Discord.postDiscordMessage('[' + config.server + '] Version: ' + version);

    Temp.mkdirs();

    app = express();

    {
        console.log("Creating logger")

        // setup the logger
        app.use(morgan('combined', {
            stream: {
                write(str: string) {
                    httpLogger.http(str.trim())
                }
            }
        }))
        morgan.token('remote-addr', (req, res): string => {
            return req.headers['x-real-ip'] as string || req.headers['x-forwarded-for'] as string || req.connection.remoteAddress || "";
        });
    }


    {
        console.log("Setting up express middleware")

        port = config.port || 3014;
        const metrics = await MineSkinMetrics.get();

        app.set("trust proxy", 1);
        app.use(bodyParser.urlencoded({extended: true, limit: '50kb'}));
        app.use(bodyParser.json({limit: '20kb'}));
        app.use(cookieParser(config.cookie.secret));
        app.use((req, res, next) => {
            res.header("X-MineSkin-Server", config.server || "default");
            next();
        });
        app.use((req, res, next) => metrics.apiRequestsMiddleware(req, res, next));

        // register remote config stuff here since we need the body middleware
        const webhookHandler = new GithubWebhook({
            events: ["check_run"],
            secret: config.gitconfig.secret
        });
        app.use(config.gitconfig.endpoint, webhookHandler.middleware, (req, res) => {
            try {
                if (req.body["action"] === "completed" && req.body["check_run"]["conclusion"] === "success") {
                    console.log(info("Invalidating git configs..."));
                    GitConfig.invalidateAll().then(b => {
                        console.log(info("invalidated: " + b));
                    }).catch(e => {
                        Sentry.captureException(e);
                    })
                }
                res.sendStatus(200);
            } catch (e) {
                Sentry.captureException(e);
            }
        })

        app.use("/.well-known", express.static(".well-known"));
    }

    /*
    {// Git Puller
        console.log("Setting up git puller");

        const updateDelay = ((Math.round(Math.random() * 10) * 5) * 1000) + Math.ceil(Math.random() * 20000);
        const puller = new Puller({
            ...{
                events: ["push"],
                branches: ["master"],
                vars: {
                    appName: "mineskin"
                },
                commandOrder: ["pre", "git", "install", "post"],
                commands: {
                    git: [
                        "git fetch --all",
                        "git reset --hard origin/master"
                    ],
                    install: [
                        "npm install",
                        "npm run build"
                    ],
                    post: [
                        "pm2 restart $appName$"
                    ]
                },
                delays: {
                    pre: updateDelay,
                    install: Math.ceil(Math.random() * 200),
                    post: Math.ceil(Math.random() * 1000)
                }
            },
            ...config.puller
        });
        puller.on("before", (req: Request, res: Response) => {
            console.log(`waiting ${ updateDelay }ms before updating`);
            setTimeout(() => {
                console.log("updating!")
                updatingApp = true;
                console.log(process.cwd());
                Discord.postDiscordMessage("[" + config.server + "] updating!");
            }, updateDelay + 9000);
        });
        puller.on("error", (err: any) => {
            console.warn(err);
            updatingApp = false;
            Discord.postDiscordMessage("[" + config.server + "] update errored! " + err);
        });
        app.use(config.puller.endpoint, bodyParser.json({limit: '100kb'}), puller.middleware);
    }
     */

    {
        console.log("Connecting to database")
        await connectToMongo();
    }

    {
        console.info("Connecting to Redis...")
        await container.resolve(RedisProvider).connect();
        // await initRedis();
        // TrafficService.init(redisClient!, redisPub!, redisSub!, Log.l.child({label: "Traffic"}));
        // BillingService.init(redisClient!, redisPub!, redisSub!, Log.l.child({label: "Billing"}));
    }

    {
        console.log("Registering routes");

        app.get("/", corsMiddleware, function (req, res) {
            res.json({msg: "Hi!"});
        });

        app.get("/test/useragent", async (req, res) => {
            res.json({
                useragent: req.headers["user-agent"],
                parsed: new UAParser(req.headers["user-agent"]).getResult(),
                simplified: simplifyUserAgent(req.headers["user-agent"] as string)
            });
        });

        app.get("/version", (req, res) => {
            res.json({
                env: process.env.NODE_ENV,
                version: process.env.SOURCE_COMMIT
            })
        });

        app.get("/health", async function (req, res) {
            const metrics = await MineSkinMetrics.get();
            const influx_ = await metrics.metrics?.influx.ping(5000);
            const influx = influx_ && influx_.length > 0 ? influx_[0] : undefined;
            const mongo = mongoose.connection.readyState;
            const redis = await container.resolve(RedisProvider).client.ping();

            return res.json({
                server: config.server,
                mongo: {
                    ok: mongo === 1,
                    state: mongo
                },
                influx: {
                    ok: influx && influx.online,
                    rtt: influx?.rtt
                },
                redis: {
                    ok: redis === "PONG",
                    res: redis
                }
            });
        });

        app.get("/openapi.yml", corsMiddleware, (req, res) => {
            res.sendFile("/openapi.yml", {root: `${ __dirname }/..`});
        });
        app.get("/v1/openapi.json", corsMiddleware, (req, res) => {
            res.sendFile("/openapi.v1.json", {root: `${ __dirname }/..`});
        });
        app.get("/v2/openapi.json", corsMiddleware, (req, res) => {
            res.sendFile("/openapi.v2.json", {root: `${ __dirname }/..`});
        });
        app.get("/openapi", (req, res) => {
            res.redirect("https://rest.wiki/?https://api.mineskin.org/openapi.yml");
        });
        app.get("/v2/openapi", (req, res) => {
            res.redirect("https://rest.wiki/?https://api.mineskin.org/v2/openapi.json");
        });
        app.get("/robots.txt", (req, res) => {
            res.send("User-Agent: *\n" +
                "Disallow: /generate\n" +
                "Disallow: /account\n")
        });

        generateRoute.register(app);
        getRoute.register(app);
        renderRoute.register(app);
        accountRoute.register(app, config);
        accountManagerRoute.register(app, config);
        testerRoute.register(app);
        utilRoute.register(app);
        apiKeyRoute.register(app);
        hiatusRoute.register(app);

        app.use("/v2/generate", v2GenerateRouter);
        app.use("/v2/queue", v2QueueRouter);
        app.use("/v2/skins", v2SkinsRouter);
        app.use("/v2/me", v2MeRouter);
        app.use("/v2/delay", v2DelayRouter);
        app.use("/v2/images", v2ImagesRouter);
        if (process.env.NODE_ENV !== 'production') {
            app.use("/v2/test", v2TestRouter);
        }
        app.use("/v2", v2ErrorHandler);
        app.get("/v2/*", v2NotFoundHandler);

    }

    // flush logs
    app.use((req, res, next) => {
        next();
    })

    const preErrorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
        console.warn(warn((isBreadRequest(req) ? req.breadcrumb + " " : "") + "Error in a route " + err.message));
        Sentry.setExtra("route", req.path);
        console.debug(debug(req.path));
        if (err instanceof MineSkinError) {
            Sentry.setTags({
                "error_type": err.name,
                "error_code": err.code
            });
            if (err instanceof AuthenticationError || err instanceof GeneratorError) {
                addErrorDetailsToSentry(err);
            }
            if (err.meta?.httpCode) {
                Sentry.setTag("error_httpcode", `${ err.meta?.httpCode }`);
                res.status(err.meta?.httpCode);
            } else {
                res.status(500);
            }
        } else {
            Sentry.setTag("unhandled_error", err.name)
        }
        next(err);
    };
    app.use(preErrorHandler);
    Sentry.setupExpressErrorHandler(app);
    // app.use(Sentry.Handlers.errorHandler({
    //     shouldHandleError: (error) => {
    //         if (error.status === 400) {
    //             return Math.random() < 0.1;
    //         }
    //         return true;
    //     }
    // }));
    const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
        if (err instanceof MineSkinError) {
            getAndValidateRequestApiKey(req)
                .catch(e => {
                    Sentry.captureException(e);
                    // Original error might be invalid api key, so don't trigger it again here
                    return undefined;
                })
                .then(key => {
                    Generator.getDelay(key).then(delayInfo => {
                        res.json({
                            success: false,
                            errorType: err.name,
                            errorCode: err.code,
                            error: err.msg,
                            breadcrumb: isBreadRequest(req) ? req.breadcrumbId : null,
                            nextRequest: Math.round((Date.now() / 1000) + delayInfo.seconds), // deprecated

                            delayInfo: {
                                seconds: delayInfo.seconds,
                                millis: delayInfo.millis
                            }
                        });
                    }).catch(e => Sentry.captureException(e));
                });
        } else {
            Log.l.error("Unexpected Error", err);
            Sentry.captureException(err, {
                level: "fatal"
            });
            res.status(500).json({
                success: false,
                error: "An unexpected error occurred",
                errorType: err.name,
                details: err.message,
                breadcrumb: isBreadRequest(req) ? req.breadcrumbId : null
            })
        }
    }
    app.use(errorHandler);

    app.use(function (req: Request, res: Response, next: NextFunction) {
        if (updatingApp) {
            res.status(503).send({err: "app is updating"});
            return;
        }
        next();
    });

    if (config.balanceServers?.includes(config.server)) {
        console.log("Starting balancing task");
        // Balancer.balance()
        setInterval(() => {
            try {
                Balancer.balance();
            } catch (e) {
                Sentry.captureException(e);
            }
        }, 1000 * 60 * 5);
    }

    if (config.statsServers?.includes(config.server)) {
        console.log("Starting stats task");
        setInterval(() => {
            try {
                Stats.query();
            } catch (e) {
                Sentry.captureException(e);
            }
        }, 1000 * 60 * 2);

        setInterval(() => {
            try {
                Stats.slowQuery();
            } catch (e) {
                Sentry.captureException(e);
            }
        }, 1000 * 60 * 60);
        setTimeout(() => {
            try {
                Stats.slowQuery();
            } catch (e) {
                Sentry.captureException(e);
            }
        }, 1000 * 60)

        if (config.migrateRedisStats) {
            console.log("running redis migration");
            try {
                Stats.migrateAgentGenerateStatsToRedis();
            } catch (e) {
                Sentry.captureException(e);
            }
        }
    }

    setInterval(() => {
        try {
            if (Generator.lastSave == 0) return;
            let diff = Date.now() - Generator.lastSave;
            if (diff > 60 * 1000 * 10) {
                Discord.postDiscordMessage(config.server + " hasn't saved any new skins for " + (diff / 1000 / 60) + "m");
            }
        } catch (e) {
            Sentry.captureException(e);
        }
    }, 60 * 1000 * 5);
}

function addErrorDetailsToSentry(err: AuthenticationError | GeneratorError): void {
    Sentry.setExtra("error_account", err.meta?.account?.id);
    Sentry.setExtra("error_details", err.meta?.details);
    if (err.meta?.error instanceof Error) {
        console.warn(warn(err.meta?.error.message));
        Sentry.setExtra("error_details_error", err.meta.error.name);
        Sentry.setExtra("error_details_message", err.meta.error.message);
    }
    if (err.meta?.details && err.meta?.details.response) {
        Sentry.setExtra("error_response", err.meta.details.response);
        Sentry.setExtra("error_response_data", err.meta.details.response.data);
    }
}


init().then(() => {
    setTimeout(() => {
        console.log("Starting app");
        server = app.listen(port, function () {
            console.log(info(" ==> listening on *:" + port + "\n"));
            setTimeout(() => {
                updatingApp = false;
                console.log(info("Accepting connections."));
            }, 100);
        });
        const timeout = 30000;
        server.setTimeout(timeout, function () {
            console.warn(warn(`A request timed out after ${ timeout }ms!`))
            Sentry.captureException(new Error('request timeout'));
        })
    }, 1000);
});

// https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392
export function shutdown(signal: string, value: number) {
    console.log("shutdown");
    Sentry.captureException(new Error(`Shutdown by ${ signal } with value ${ value }`));
    updatingApp = true;
    setInterval(() => {
        console.error("shutdown timeout");
        process.exit(128 + value);
    }, 20000);
    setTimeout(async () => {
        try {
            await server.close();
        } catch (e) {
            console.error(e);
        }
        try {
            await mongoose.disconnect();
        } catch (e) {
            console.error(e);
        }
        try {
            const redis = container.resolve(RedisProvider);
            await redis?.client?.quit();
            await redis?.sub?.quit();
            await redis?.pub?.quit();
        } catch (e) {
            console.error(e);
        }

        console.warn(`server stopped by ${ signal } with value ${ value }`);
        try {
            await Sentry.close();
        } catch (e) {
            console.error(e);
        }
        process.exit(128 + value);
    }, 100 + Math.random() * 1000);
}

const shutdownCounts: Record<string, number> = {};
(() => {
    setInterval(() => {
        Object.keys(shutdownCounts).forEach((signal) => {
            if (shutdownCounts[signal] > 0) {
                shutdownCounts[signal]--;
            }
        });
    }, 1000 * 30);
})();

export function requestShutdown(signal: string, value: number) {
    if (process.env.NODE_ENV === "development") {
        return;
    }
    Sentry.captureMessage(`Requesting shutdown by ${ signal } with value ${ value }`);
    if (!shutdownCounts[signal]) {
        shutdownCounts[signal] = 0;
    }
    if (shutdownCounts[signal]++ >= 3) {
        shutdown(signal, value);
    }
}

const signals: Record<string, number> = {
    'SIGHUP': 1,
    'SIGINT': 2,
    'SIGTERM': 15
};
Object.keys(signals).forEach((signal) => {
    process.on(signal, () => {
        console.log(`process received a ${ signal } signal`);
        shutdown(signal, signals[signal]);
    });
});