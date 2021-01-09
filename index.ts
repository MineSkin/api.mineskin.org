import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import * as path from "path";
import * as fs from "fs";
import { Config } from "./types/Config";
import * as express from "express";
import { Express } from "express";
import { Puller } from "express-git-puller";
import connectToMongo from "./database/database";
import RotatingFileStream from "rotating-file-stream";
import * as morgan from "morgan";
import * as bodyParser from "body-parser";
import * as fileUpload from "express-fileupload";
import * as ExpressValidator from "express-validator";
import { RateLimit } from "express-rate-limit";
import Optimus from "optimus-js";
import { apiRequestsMiddleware, info, metrics } from "./util";
import * as rateLimit from "express-rate-limit";
import { renderRoute, testerRoute, utilRoute } from "./routes";
import { generateLimiter } from "./util/rateLimiters";
import { MOJ_DIR, Temp, UPL_DIR, URL_DIR } from "./generator/Temp";


const config: Config = require("./config");
const port = process.env.PORT || config.port || 3014;

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

const app: Express = express();


async function init() {

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
            tracesSampleRate: 0.05
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
            return req.headers['x-real-ip'] as string || req.headers['x-forwarded-for'] as string || req.connection.remoteAddress;
        });


    }


    {
        console.log("Setting up express middleware")

        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            if (req.method === 'OPTIONS') {
                res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
                res.header("Access-Control-Allow-Headers", "X-Requested-With, Accept, Content-Type, Origin");
                res.header("Access-Control-Request-Headers", "X-Requested-With, Accept, Content-Type, Origin");
                return res.sendStatus(200);
            } else {
                return next();
            }
        });
        app.use(bodyParser.urlencoded({ extended: true }));
        app.use(bodyParser.json());
        app.use(ExpressValidator());
        app.use(fileUpload());
        app.use((req, res, next) => {
            res.header("X-Mineskin-Server", config.server || "default");
            next();
        });
        app.use(apiRequestsMiddleware);

        app.use("/.well-known", express.static(".well-known"));
    }

    {// Git Puller
        console.log("Setting up git puller");

        const puller = new Puller(config.puller);
        let updatingApp = false;
        puller.on("before", (req, res) => {
            updatingApp = true;
        });
        puller.on("after", (req, res) => {
            updatingApp = false;
        });
        app.use(function (req, res, next) {
            if (updatingApp) {
                res.status(503).send({ err: "app is updating" });
                return;
            }
            next();
        });
        app.use(config.puller.endpoint, puller.middleware);
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

        app.use("/generate", generateLimiter);

        //TODO: replace these
        require("./routes/generate")(app);
        require("./routes/get")(app);
        require("./routes/admin")(app);
        require("./routes/accountManager")(app);

        renderRoute.register(app);
        testerRoute.register(app);
        utilRoute.register(app);

    }

    app.use(Sentry.Handlers.errorHandler());
}


init().then(() => {
    setTimeout(() => {
        console.log("Starting app");
        app.listen(port, function () {
            console.log(info(" ==> listening on *:" + port + "\n"));
        });
    }, 2000);
});

