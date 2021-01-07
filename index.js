const express = require('express');
const app = express();
const http = require('http');
const server = http.Server(app);
const session = require("express-session");
const Util = require('./util');
const bodyParser = require("body-parser");
const expressValidator = require('express-validator')
const fileUpload = require('express-fileupload');
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const Cookies = require("cookies");
const extend = require('util')._extend
const restClient = new (require("node-rest-client")).Client()
const unirest = require("unirest");
const crypto = require('crypto');
const fs = require('fs')
const morgan = require('morgan')
const rfs = require("rotating-file-stream");
const rateLimit = require("express-rate-limit");
const Optimus = require("optimus-js");
const puller = require("express-git-puller");
const path = require('path')
const colors = require("colors");
const metrics = require("./metrics");
const config = require("./config");
const port = process.env.PORT || config.port || 3014;

const TESTER_METRICS = metrics.metric('mineskin', 'tester');

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

Sentry.init({
    dsn: config.sentry.dsn,
    integrations: [
        new Sentry.Integrations.Http({tracing: true}),
        new Tracing.Integrations.Express({app})
    ],
    tracesSampleRate: 0.001,
    serverName: config.server
});

require("rootpath")();
require('console-stamp')(console, 'HH:MM:ss.l');

// require("./statusMonitor")(app, config);

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

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

app.use(function (req, res, next) {
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
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json({extended: true}));
app.use(expressValidator());
app.use(fileUpload());
app.use(function (req, res, next) {
    req.realAddress = req.header("x-real-ip") || req.realAddress;
    res.header("X-Mineskin-Server", config.server || "default");
    next();
});

app.use("/.well-known", express.static(".well-known"));

// const swStats = require('swagger-stats');
// app.use(swStats.getMiddleware(config.swagger));

// create a rotating write stream
const accessLogStream = rfs('access.log', {
    interval: '1d', // rotate daily
    path: path.join(__dirname, 'log'),
    compress: "gzip"
})

// setup the logger
app.use(morgan('combined', {stream: accessLogStream}))
morgan.token('remote-addr', function (req) {
    return req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
});

let updatingApp = false;
config.puller.beforeRun = function (req, res) {
    updatingApp = true;
};
config.puller.afterRun = function (req, res) {
    updatingApp = false;
};
app.use(function (req, res, next) {
    if (updatingApp) {
        res.status(503).send({err: "app is updating"});
        return;
    }
    next();
});
// Git Puller
app.use(config.puller.endpoint, new puller(config.puller));

colors.setTheme({
    silly: 'rainbow',
    input: 'grey',
    prompt: 'grey',
    info: 'green',
    data: 'grey',
    help: 'cyan',
    warn: 'yellow',
    debug: 'cyan',
    error: 'red'
});

// Databse
require("./db/db")(mongoose, config);
const Skin = require("./db/schemas/skin").Skin;

// API methods
app.get("/", function (req, res) {
    res.json({msg: "Hi!"});
});


app.post("/testing/upload_tester_result", function (req, res) {
    if (!config.testing.testerToken || req.body.token !== config.testing.testerToken) return;
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
            Skin.findOneAndUpdate({id: req.body.data.i, server: req.body.data.s}, {testerRequest: true, testerMismatchCounter: req.body.data.m || 0});
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
    message: JSON.stringify({error: "Too many requests"}),
    keyGenerator: function (req) {
        return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.realAddress || req.connection.remoteAddress
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
