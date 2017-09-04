var express = require('express');
var app = express();
var http = require('http');
var server = http.Server(app);
var session = require("express-session");
var Util = require('./util');
var bodyParser = require("body-parser");
var expressValidator = require('express-validator')
var fileUpload = require('express-fileupload');
var mongoose = require("mongoose");
var cookieParser = require("cookie-parser");
var Cookies = require("cookies");
var extend = require('util')._extend
var restClient = new (require("node-rest-client")).Client()
var unirest = require("unirest");
var crypto = require('crypto');
var fs = require('fs')
var morgan = require('morgan')
var path = require('path')
var colors = require("colors");
var config = require("./config");
var port = process.env.PORT || config.port || 3014;

require("rootpath")();
require('console-stamp')(console, 'HH:MM:ss.l');

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
    next();
})

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// create a write stream (in append mode)
var accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), {flags: 'a'})
// setup the logger
app.use(morgan('combined', {stream: accessLogStream}))

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

// Schemas
var Account = require("./db/schemas/account").Account;
var Skin = require("./db/schemas/skin").Skin;
var Traffic = require("./db/schemas/traffic").Traffic;


// API methods
app.get("/", function (req, res) {
    res.json({msg: "Hi!"});
});

app.get("/encrypt/:text", function (req, res) {
    res.json({enc: Util.crypto.encrypt(req.params.text)});
});

app.get("/decrypt/:text", function (req, res) {
    res.json({dec: Util.crypto.decrypt(req.params.text)});
});

/// Routes
require("./routes/generate")(app);
require("./routes/get")(app);
require("./routes/render")(app);
require("./routes/admin")(app);

// TODO: remove
Skin.find({}, function (err, skins) {
    var invalid = [];
    skins.forEach(function (skin) {
        if (skin._id === undefined || typeof skin._id !== "object") {
            console.log(("Invalid _id field for skin #" + skin.id).error);
            console.log(("" + skin).debug)
            invalid.push(skin.id);
        }
    });
    console.log((""+invalid).debug)
})

function exitHandler(err) {
    if (err) {
        console.log(err)
    }
    process.exit();
}


server.listen(port, function () {
    console.log('listening on *:' + port);
});

process.on("exit", exitHandler);
process.on("SIGINT", exitHandler);
process.on("uncaughtException", exitHandler);