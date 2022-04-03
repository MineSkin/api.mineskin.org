import * as sourceMapSupport from "source-map-support";
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import * as path from "path";
import * as fs from "fs";
import express, { ErrorRequestHandler, Express, NextFunction, Request, Response } from "express";
import "express-async-errors";
import { Puller } from "express-git-puller";
import { connectToMongo } from "./database/database";
import RotatingFileStream from "rotating-file-stream";
import morgan from "morgan";
import * as bodyParser from "body-parser";
import fileUpload from "express-fileupload";
import cookieParser from "cookie-parser";
import { accountManagerRoute, accountRoute, apiKeyRoute, generateRoute, getRoute, hiatusRoute, renderRoute, testerRoute, utilRoute } from "./routes";
import { MOJ_DIR, UPL_DIR, URL_DIR } from "./generator/Temp";
import { getConfig, getLocalConfig, MineSkinConfig } from "./typings/Configs";
import { isBreadRequest, MineSkinError } from "./typings";
import { MineSkinMetrics } from "./util/metrics";
import { corsMiddleware, getAndValidateRequestApiKey } from "./util";
import { AuthenticationError } from "./generator/Authentication";
import { Generator, GeneratorError } from "./generator/Generator";
import gitsha from "@inventivetalent/gitsha";
import { GitConfig } from "@inventivetalent/gitconfig";
import { GithubWebhook } from "@inventivetalent/express-github-webhook/dist/src";
import { Stats } from "./generator/Stats";
import { Requests } from "./generator/Requests";
import { info, warn } from "./util/colors";
import { Discord } from "./util/Discord";
import { Balancer } from "./generator/Balancer";

sourceMapSupport.install();

let config: MineSkinConfig;
let port: number;

let updatingApp = true;

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

const app: Express = express();


async function init() {
    console.log("Node Version " + process.version);

    {// Config
        console.log("Setting up config");

        const localConfig = getLocalConfig();
        GitConfig.source = localConfig.gitconfig.base;
        GitConfig.local = localConfig.gitconfig.local;
        GitConfig.axiosInstance.defaults.headers["Accept"] = "application/vnd.github.v3.raw";
        GitConfig.axiosInstance.defaults.headers["Authorization"] = "token " + localConfig.gitconfig.token;

        config = await getConfig();

        Requests.init(config);
    }

    const version = await gitsha();
    console.log(info("Version: " + version));
    Discord.postDiscordMessage('[' + config.server + '] Version: ' + version);

    {
        console.log("Creating temp directories");
        try {
            fs.mkdirSync(URL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(UPL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(MOJ_DIR);
        } catch (e) {
        }
    }

    {
        console.log("Initializing Sentry")
        Sentry.init({
            dsn: config.sentry.dsn,
            release: version,
            integrations: [
                new Sentry.Integrations.Http({ tracing: true }),
                new Tracing.Integrations.Express({ app })
            ],
            serverName: config.server,
            tracesSampleRate: 0.1,
            sampleRate: 0.8,
            ignoreErrors: [
                "No duplicate found",
                "Invalid image file size",
                "Invalid image dimensions",
                "Failed to find image from url",
                "Invalid file size"
            ]
        });

        app.use(Sentry.Handlers.requestHandler());
        app.use(Sentry.Handlers.tracingHandler());
    }

    {
        console.log("Creating logger")

        // create a rotating write stream
        const accessLogStream = RotatingFileStream('access.log', {
            interval: '1d', // rotate daily
            path: path.join(__dirname, 'log'),
            compress: "gzip"
        });

        // setup the logger
        app.use(morgan('combined', { stream: accessLogStream }))
        morgan.token('remote-addr', (req, res): string => {
            return req.headers['x-real-ip'] as string || req.headers['x-forwarded-for'] as string || req.connection.remoteAddress || "";
        });
    }


    {
        console.log("Setting up express middleware")

        port = config.port || 3014;
        const metrics = await MineSkinMetrics.get();

        app.set("trust proxy", 1);
        app.use(bodyParser.urlencoded({ extended: true, limit: '50kb' }));
        app.use(bodyParser.json({ limit: '20kb' }));
        app.use(fileUpload());
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
            }, updateDelay + 5000);
        });
        app.use(function (req: Request, res: Response, next: NextFunction) {
            if (updatingApp) {
                res.status(503).send({ err: "app is updating" });
                return;
            }
            next();
        });
        app.use(config.puller.endpoint, bodyParser.json({ limit: '100kb' }), puller.middleware);
    }

    {
        console.log("Connecting to database")
        await connectToMongo(config);
    }

    {
        console.log("Registering routes");

        app.get("/", corsMiddleware, function (req, res) {
            res.json({ msg: "Hi!" });
        });

        app.get("/openapi.yml", corsMiddleware, (req, res) => {
            res.sendFile("/openapi.yml", { root: `${ __dirname }/..` });
        });
        app.get("/openapi", (req, res) => {
            res.redirect("https://rest.wiki/?https://api.mineskin.org/openapi.yml");
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

    }

    const preErrorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
        console.warn(warn((isBreadRequest(req) ? req.breadcrumb + " " : "") + "Error in a route " + err.message));
        if (err instanceof MineSkinError) {
            Sentry.setTags({
                "error_type": err.name,
                "error_code": err.code
            });
            if (err instanceof AuthenticationError || err instanceof GeneratorError) {
                addErrorDetailsToSentry(err);
            }
            if (err.httpCode) {
                Sentry.setTag("error_httpcode", `${ err.httpCode }`);
                res.status(err.httpCode);
            } else {
                res.status(500);
            }
        } else {
            Sentry.setTag("unhandled_error", err.name)
        }
        next(err);
    };
    app.use(preErrorHandler);
    app.use(Sentry.Handlers.errorHandler({
        shouldHandleError: (error) => {
            if (error.status === 400) {
                return Math.random() < 0.1;
            }
            return true;
        }
    }));
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
                            nextRequest: (Date.now() / 1000) + delayInfo.seconds, // deprecated

                            delayInfo: {
                                seconds: delayInfo.seconds,
                                millis: delayInfo.millis
                            }
                        });
                    }).catch(e => Sentry.captureException(e));
                });
        } else {
            console.warn(err);
            res.status(500).json({
                success: false,
                error: "An unexpected error occurred"
            })
        }
    }
    app.use(errorHandler);

    if (config.balanceServers?.includes(config.server)) {
        console.log("Starting balancing task");
        // Balancer.balance()
        setInterval(() => {
            try {
                Balancer.balance();
            } catch (e) {
                Sentry.captureException(e);
            }
        }, 1000 * 60 * 15);
    }

    if (config.statsServers?.includes(config.server)) {
        console.log("Starting stats task");
        setInterval(() => {
            try {
                Stats.query();
            } catch (e) {
                Sentry.captureException(e);
            }
        }, 1000 * 60 * 5);
    }
}

function addErrorDetailsToSentry(err: AuthenticationError | GeneratorError): void {
    Sentry.setExtra("error_account", err.account?.id);
    Sentry.setExtra("error_details", err.details);
    if (err.details instanceof Error) {
        console.warn(warn(err.details.message));
        Sentry.setExtra("error_details_error", err.details.name);
        Sentry.setExtra("error_details_message", err.details.message);
    }
    if (err.details && err.details.response) {
        Sentry.setExtra("error_response", err.details.response);
        Sentry.setExtra("error_response_data", err.details.response.data);
    }
}


init().then(() => {
    setTimeout(() => {
        console.log("Starting app");
        const server = app.listen(port, function () {
            console.log(info(" ==> listening on *:" + port + "\n"));
            setTimeout(() => {
                updatingApp = false;
                console.log(info("Accepting connections."));
            }, 1000);
        });
        const timeout = 30000;
        server.setTimeout(timeout, function () {
            console.warn(warn(`A request timed out after ${ timeout }ms!`))
            Sentry.captureException(new Error('request timeout'));
        })
    }, 1000);
});


