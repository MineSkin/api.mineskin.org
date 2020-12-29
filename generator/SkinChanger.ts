
export class SkinChanger {

    static requestQueue

}


const request = require('request');
// request.debug=true;
const urls = require("./urls");
const fs = require("fs");
const authentication = require("./authentication");
const randomip = require("random-ip");
const Sentry = require("@sentry/node");
const metrics = require("../util/metrics");

const config = require("../config");

// Schemas
const Account = require("../database/schemas/Account").IAccount;
const Skin = require("../database/schemas/Skin").ISkin;
const Traffic = require("../database/schemas/Traffic").ITraffic;

module.exports = {};

const requestQueue = [];
module.exports.requestQueue = requestQueue;
setInterval(function () {
    const next = requestQueue.shift();
    if (next) {
        try {
            const d = new Date().toUTCString();
            request(next.options, function (err, res, body) {
                try {
                    metrics.requestsMetric(next.options, res).inc();
                } catch (e) {
                    console.warn(e);
                    Sentry.captureException(e);
                }
                // fs.appendFileSync("requests.log", "[" + d  + "] SKIN "+ (next.options.method||"GET")+" " + (next.options.url||next.options.uri) + " => "+res.statusCode+"\n", "utf8");
                next.callback(err, res, body);
            });
        } catch (e) {
            console.error(e);
            Sentry.captureException(e);
        }
    }
}, config.requestQueue.skinChanger);
setInterval(function () {
    try {
        metrics.influx.writePoints([{
            measurement: "queue.skinChanger",
            tags: {
                server: config.server
            },
            fields: {
                size: requestQueue.length
            }
        }],{
            database: 'mineskin'
        });
    } catch (e) {
        console.warn(e);
        Sentry.captureException(e);
    }
}, 10000);
setInterval(function () {
    console.log("[SkinChanger] Request Queue Size: " + requestQueue.length);
}, 30000)

function queueRequest(options, callback) {
    requestQueue.push({options: options, callback: callback})
}

module.exports.findExistingSkin = function (hash, name, model, visibility, cb) {
    Skin.findOne({hash: hash, name: name, model: model, visibility: visibility}).exec(function (err, skin) {
        if (err) return console.log(err);
        if (skin) {
            console.log("Found existing skin with same hash");
            skin.duplicate += 1;
            skin.save(function (err, skin) {
                if (err) return console.log(err);
                cb(skin);
            })
        } else {
            cb();
        }
    })
};

module.exports.findExistingSkinForTextureUrl = function (url, name, model, visibility, cb) {
    Skin.findOne({url: url, name: name, model: model, visibility: visibility}).exec(function (err, skin) {
        if (err) return console.log(err);
        if (skin) {
            console.log("Found existing skin with same texture url");
            skin.duplicate += 1;
            skin.save(function (err, skin) {
                if (err) return console.log(err);
                cb(skin);
            })
        } else {
            cb();
        }
    })
};


module.exports.getAvailableAccount = function (req, res, cb) {
    const time = Date.now() / 1000;
    Account.findOne({enabled: true, requestServer: {$in: [null, "default", config.server]}, lastUsed: {'$lt': (time - 100)}, forcedTimeoutAt: {'$lt': (time - 500)}, errorCounter: {'$lt': (config.errorThreshold || 10)}, timeAdded: {'$lt': time - 60}})
        .sort({lastUsed: 1, lastSelected: 1, sameTextureCounter: 1}).exec(function (err, account) {
        if (err) return console.log(err);
        if (!account) {
            console.log(("[SkinChanger] There are no accounts available!").error);
            res.status(500).json({error: "No accounts available"});
        } else {
            // if (time - account.lastUsed > 3600) {// Reset tokens after 30 minutes
            //     account.accessToken = null;
            //     // account.clientToken = null;
            // }
            console.log("Account #" + account.id + " last used " + Math.round(time - account.lastUsed) + "s ago, last selected " + Math.round(time - account.lastSelected) + "s ago")
            account.lastUsed = account.lastSelected = time;
            if (!account.successCounter) account.successCounter = 0;
            if (!account.errorCounter) account.errorCounter = 0;
            if (!account.totalSuccessCounter) account.totalSuccessCounter = 0;
            if (!account.totalErrorCounter) account.totalErrorCounter = 0;
            account.save(function (err, account) {
                cb(account);
            });
        }
    })
}

module.exports.generateUrl = function (account, url, model, cb) {
    console.log(("[SkinChanger] Generating Skin from URL").info);
    console.log(("" + url).debug);

    if (model === "steve") {
        model = "classic";
    }

    if (!account.requestIp)
        account.requestIp = randomip('0.0.0.0', 0);
    console.log(("Using ip " + account.requestIp).debug);

    function authenticated() {
        account.lastUsed = account.lastSelected;// account *should* be saved in the following code, so there shouldn't be any need to make another call here
        if (account.requestServer)
            account.lastRequestServer = account.requestServer;
        account.requestServer = config.server;

        queueRequest({
            method: "POST",
            url: urls.skin,
            headers: {
                "User-Agent": "MineSkin.org",
                "Content-Type": "application/json",
                "Authorization": "Bearer " + account.accessToken,
                "X-Forwarded-For": account.requestIp,
                "REMOTE_ADDR": account.requestIp
            },
            json: {
                variant: model,
                url: url
            }
        }, function (err, response, body) {
            if (err) return console.log(err);
            console.log(("Url response (acc#" + account.id + "): " + response.statusCode + " " + JSON.stringify(body)).debug);
            if (response.statusCode >= 200 && response.statusCode < 300) {
                cb(true);
            } else if (response.statusCode === 403 && body.toString().toLowerCase().indexOf("not secured") !== -1) { // check for "Current IP not secured" error (probably means the account has no security questions configured, but actually needs them)
                account.successCounter = 0;
                account.errorCounter++;
                account.totalErrorCounter++;
                account.save(function (err, account) {
                    cb("Challenges failed", "location_not_secured");
                });
            } else {
                cb(response.statusCode, "generate_rescode_" + response.statusCode);
                console.log(("Got response " + response.statusCode + " for generateUrl").warn);
                console.warn(url);
            }
        })
    }

    authentication.authenticate(account, function (authErr, authResult) {
        if (!authErr && authResult) {
            if (account.microsoftAccount) {
                authenticated();
            } else {
                authentication.completeChallenges(account, function (result, errorBody) {
                    if (result) {
                        authenticated();
                    } else {
                        account.successCounter = 0;
                        account.errorCounter++;
                        account.totalErrorCounter++;
                        account.save(function (err, account) {
                            cb("Challenges failed", authErrorCauseFromMessage(errorBody.errorMessage || errorBody) || "challenges_failed");
                        });
                    }
                });
            }
        } else {
            account.successCounter = 0;
            account.errorCounter++;
            account.totalErrorCounter++;
            account.forcedTimeoutAt = Date.now() / 1000;
            account.accessToken = null;
            if (account.requestServer)
                account.lastRequestServer = account.requestServer;
            account.requestServer = null;
            console.warn("Account #" + account.id + " force timeout")
            account.save(function (err, account) {
                cb("Authentication failed - " + (authErr.errorMessage || "unknown error"), authErrorCauseFromMessage(authErr.errorMessage || authErr));
            });
        }
    })
};


// 'fileBuf' must be a buffer
module.exports.generateUpload = function (account, fileBuf, model, cb) {
    console.log(("[SkinChanger] Generating Skin from Upload").info);
    if (model === "steve") {
        model = "classic";
    }

    if (!account.requestIp) {
    }
    account.requestIp = randomip('0.0.0.0', 0);
    console.log(("Using ip " + account.requestIp).debug);

    function authenticated() {
        account.lastUsed = account.lastSelected;// account *should* be saved in the following code, so there shouldn't be any need to make another call here
        if (account.requestServer)
            account.lastRequestServer = account.requestServer;
        account.requestServer = config.server;


        queueRequest({
            method: "POST",
            url: urls.skin,
            headers: {
                "User-Agent": "MineSkin.org",
                "Content-Type": "multipart/form-data",
                "Authorization": "Bearer " + account.accessToken,
                "X-Forwarded-For": account.requestIp,
                "REMOTE_ADDR": account.requestIp
            },
            formData: {
                variant: model,
                file: {
                    value: fileBuf,
                    options: {
                        filename: "skin.png",
                        contentType: "image/png"
                    }
                }
            }
        }, function (err, response, body) {
            if (err) return console.log(err);
            console.log(("Upload response (acc#" + account.id + "): " + response.statusCode + " " + JSON.stringify(body)).debug);
            if (response.statusCode >= 200 && response.statusCode < 300) {
                cb(true);
            } else if (response.statusCode === 403 && body.toString().toLowerCase().indexOf("not secured") !== -1) { // check for "Current IP not secured" error (probably means the account has no security questions configured, but actually needs them)
                account.successCounter = 0;
                account.errorCounter++;
                account.totalErrorCounter++;
                account.save(function (err, account) {
                    cb("Challenges failed", "location_not_secured");
                });
            } else {
                cb(response.statusCode, "generate_rescode_" + response.statusCode);
                console.log(("Got response " + response.statusCode + " for generateUpload").warn);
            }
        });
    }

    authentication.authenticate(account, function (authErr, authResult) {
        if (!authErr && authResult) {
            if (account.microsoftAccount) {
                authenticated();
            } else {
                authentication.completeChallenges(account, function (result, errorBody) {
                    if (result) {
                        authenticated();
                    } else {
                        account.successCounter = 0;
                        account.errorCounter++;
                        account.totalErrorCounter++;
                        account.save(function (err, account) {
                            console.log(("Challenges failed").warn);
                            cb("Challenges failed", authErrorCauseFromMessage(errorBody.errorMessage || errorBody) || "challenges_failed");
                        });
                    }
                });
            }
        } else {
            account.successCounter = 0;
            account.errorCounter++;
            account.totalErrorCounter++;
            account.forcedTimeoutAt = Date.now() / 1000;
            account.accessToken = null;
            if (account.requestServer)
                account.lastRequestServer = account.requestServer;
            account.requestServer = null;
            console.warn("Account #" + account.id + " force timeout")
            account.save(function (err, account) {
                cb("Authentication failed - " + (authErr.errorMessage || "unknown error"), authErrorCauseFromMessage(authErr.errorMessage || authErr));
            });
        }
    })
};


function authErrorCauseFromMessage(msg) {
    if (msg && msg.length > 0) {
        if (msg.indexOf("Invalid credentials") !== -1) {
            return "invalid_credentials";
        }
        if (msg.indexOf("answer was incorrect") !== -1) {
            return "wrong_security_answers";
        }
        if (msg.indexOf("cloudfront") !== -1) {
            if (msg.indexOf("403 ERROR") !== -1) {
                return "cloudfront_unauthorized";
            }
            return "cloudfront_error";
        }
    }
}



