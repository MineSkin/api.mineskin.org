import * as sourceMapSupport from "source-map-support";
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import * as path from "path";
import * as fs from "fs";
import * as express from "express";
import "express-async-errors";
import { ErrorRequestHandler, Express, NextFunction, Request, Response } from "express";
import { Puller } from "express-git-puller";
import connectToMongo from "./database/database";
import RotatingFileStream from "rotating-file-stream";
import * as morgan from "morgan";
import * as bodyParser from "body-parser";
import * as fileUpload from "express-fileupload";
import * as session from "express-session";
import { generateRoute, getRoute, renderRoute, testerRoute, utilRoute, accountManagerRoute } from "./routes";
import { MOJ_DIR, Temp, UPL_DIR, URL_DIR } from "./generator/Temp";
import { Time } from "@inventivetalent/loading-cache";
import { getConfig } from "./typings/Configs";
import { MineSkinError } from "./typings";
import { apiRequestsMiddleware } from "./util/metrics";
import { info } from "./util/colors";
import { hasOwnProperty } from "./util";
import { AuthenticationError } from "./generator/Authentication";
import { GeneratorError } from "./generator/Generator";

sourceMapSupport.install();

const config = getConfig();
const port = process.env.PORT || config.port || 3014;

let updatingApp = true;

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

const app: Express = express();


async function init() {
    console.log("Node Version " + process.version);

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
            integrations: [
                new Sentry.Integrations.Http({ tracing: true }),
                new Tracing.Integrations.Express({ app })
            ],
            serverName: config.server,
            tracesSampleRate: 0.05,

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

        app.use(bodyParser.urlencoded({ extended: true, limit: '50kb' }));
        app.use(bodyParser.json({ limit: '20kb' }));
        app.use(fileUpload());
        app.use((req, res, next) => {
            res.header("X-MineSkin-Server", config.server || "default");
            next();
        });
        app.use(apiRequestsMiddleware);

        app.use("/.well-known", express.static(".well-known"));
    }

    {// Git Puller
        console.log("Setting up git puller");

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
                    install: Math.ceil(Math.random() * 200),
                    post: 5000 + Math.ceil(Math.random() * 5000)
                }
            },
            ...config.puller
        });
        puller.on("before", (req: Request, res: Response) => {
            updatingApp = true;
            console.log(process.cwd());
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

        app.get("/", function (req, res) {
            res.json({ msg: "Hi!" });
        });

        generateRoute.register(app);
        getRoute.register(app);
        renderRoute.register(app);
        accountManagerRoute.register(app);
        testerRoute.register(app);
        utilRoute.register(app);

    }

    app.use(Sentry.Handlers.errorHandler());
    const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
        console.warn("Error in a route");
        if (err instanceof MineSkinError) {
            if (err.httpCode) {
                res.status(err.httpCode);
            } else {
                res.status(500);
            }
            res.json({
                success: false,
                errorCode: err.code,
                error: err.msg
            });
        } else {
            res.status(500).json({
                success: false,
                error: "An unexpected error occurred"
            })
        }
    }
    app.use(errorHandler);
}


init().then(() => {
    setTimeout(() => {
        console.log("Starting app");
        app.listen(port, function () {
            console.log(info(" ==> listening on *:" + port + "\n"));
            setTimeout(() => {
                updatingApp = false;
                console.log(info("Accepting connections."));
            }, 1000);
        });
    }, 1000);
});


