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
import fileUpload = require("express-fileupload");


const config: Config = require("./config");
const port = process.env.PORT || config.port || 3014;

const TESTER_METRICS = metrics.metric('mineskin', 'tester');

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

const app: Express = express();

async function init() {

    {
        console.log("Creating temp directories");
        try {
            fs.mkdirSync("/tmp/url");
        } catch (e) {
        }
        try {
            fs.mkdirSync("/tmp/upl");
        } catch (e) {
        }
        try {
            fs.mkdirSync("/tmp/moj");
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
        app.use(expressValidator());
        app.use(fileUpload());
        app.use((req, res, next) => {
            res.header("X-Mineskin-Server", config.server || "default");
            next();
        });

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

}

// API methods
app.get("/", function (req, res) {
    res.json({ msg: "Hi!" });
});


app.post("/testing/upload_tester_result", function (req, res) {
    if (!config.testerToken || req.body.token !== config.testerToken) return;
    if (!req.body.data) return;
    if (req.headers["user-agent"] !== "mineskin-tester") return;

    try {
        TESTER_METRICS
            .tag("server", config.server)
            .tag("result", req.body.data.r || "fail")
            .tag("mismatches", req.body.data.m > 0 ? "true" : "false")
            .inc();
    } catch (e) {
        console.warn(e);
        Sentry.captureException(e);
    }

    if (req.body.data.r === "success") {
        Util.increaseStat("mineskintester.success");
        res.sendStatus(202);

        if (req.body.data.m > 0) {
            Util.postDiscordMessage("🛑 mineskin-tester generated data with " + req.body.data.m + " image mismatches! ID: " + req.body.data.i);
        }

        if (req.body.data.i) {
            Skin.findOneAndUpdate({ id: req.body.data.i, server: req.body.data.s }, { testerRequest: true, testerMismatchCounter: req.body.data.m || 0 });
        }
    } else if (req.body.data.r === "fail") {
        Util.increaseStat("mineskintester.fail");
        res.sendStatus(202);
    } else {
        res.sendStatus(400);
    }
});

const optimus = new Optimus(config.optimus.prime, config.optimus.inverse, config.optimus.random);
console.log("Optimus Test:", optimus.encode(Math.floor(Date.now() / 10)));

const limiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes,
    max: 6,
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: function (req) {
        return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req["realAddress"] || req.connection.remoteAddress
    }
})

/// Routes
require("./routes/generate")(app, config, optimus, limiter);
require("./routes/get")(app);
require("./routes/render")(app);
require("./routes/util")(app);
require("./routes/admin")(app);
require("./routes/accountManager")(app, config);

function exitHandler(err) {
    if (err) {
        console.log("\n\n\n\n\n\n\n\n");
        console.log(err);
        console.log("\n\n\n");
    }
    process.exit();
}

app.use(Sentry.Handlers.errorHandler());

server.listen(port, function () {
    console.log(' ==> listening on *:' + port + "\n");
});

process.on("exit", exitHandler);
process.on("SIGINT", exitHandler);
process.on("uncaughtException", exitHandler);
