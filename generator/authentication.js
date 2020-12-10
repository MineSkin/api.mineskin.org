var uuid = require('uuid/v4');
var md5 = require("md5");
var urls = require("./urls");
var fs = require("fs");
var request = require("request").defaults({
    headers: {
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate",
        "Origin": "mojang://launcher",
        "User-Agent": /*"MineSkin.org"*/ "Minecraft Launcher/2.1.2481 (bcb98e4a63) Windows (10.0; x86_64)",
        "Content-Type": "application/json"
    }
});
var Util = require("../util");
var config = require("../config");

// Schemas
var Account = require("../db/schemas/account").Account;
var Skin = require("../db/schemas/skin").Skin;
var Traffic = require("../db/schemas/traffic").Traffic;

module.exports = {};

var requestQueue = [];
module.exports.requestQueue = requestQueue;

setInterval(function () {
    var next = requestQueue.shift();
    if (next) {
        try {
            var d = new Date().toUTCString();
            request(next.options, function (err, res, body) {
                fs.appendFileSync("requests.log", "[" + d + "] AUTH " + (next.options.method || "GET") + " " + (next.options.url || next.options.uri) + " => " + res.statusCode + "\n", "utf8");
                next.callback(err, res, body);
            });
        } catch (e) {
            console.error(e);
        }
    }
}, config.requestQueue.auth);
setInterval(function () {
    console.log("[Auth] Request Queue Size: " + requestQueue.length);
}, 30000)

function queueRequest(options, callback) {
    requestQueue.push({options: options, callback: callback})
}

module.exports.authenticate = function (account, cb) {
    return module.exports.authenticateMojang(account, cb);
}

module.exports.authenticateMojang = function (account, cb) {
    console.log("[Auth] authenticate(" + account.username + ")");
    // Callback to login
    var loginCallback = function (account) {
        if (account.microsoftAccount || !account.passwordNew) {
            console.warn("[Auth] (#" + account.id + ") Microsoft account doesn't have an access token!")
            notifyMissingAccessToken(account);
            cb("Missing Access Token", null);
            return;
        }

        console.log(("[Auth] (#" + account.id + ") Logging in with Username+Password").info);
        if (!account.clientToken)
            account.clientToken = md5(uuid());
        console.log(("[Auth] POST " + urls.authenticate).debug);
        var body = {
            agent: {
                name: "Minecraft",
                version: 1
            },
            username: account.username,
            password: Util.crypto.decrypt(account.passwordNew),
            clientToken: account.clientToken,
            requestUser: true,
            _timestamp: Date.now()
        };
        console.log(("[Auth] " + JSON.stringify(body)).debug);
        setTimeout(function () {
            queueRequest({
                method: "POST",
                url: urls.authenticate,
                headers: {
                    "User-Agent": "Mineskin Auth",
                    "Content-Type": "application/json",
                    "X-Forwarded-For": account.requestIp,
                    "REMOTE_ADDR": account.requestIp
                },
                json: true,
                body: body
            }, function (err, response, body) {
                console.log(("[Auth] (#" + account.id + ") Auth Body:").debug);
                console.log(("" + body).debug);
                console.log(("" + JSON.stringify(body)).debug);
                if (err || response.statusCode < 200 || response.statusCode > 230 || (body && body.error)) {
                    cb(err || body, null);
                    return console.log(err);
                }

                if (body.hasOwnProperty("selectedProfile")) {
                    account.playername = body.selectedProfile.name;
                }

                // Get new token
                // account.clientToken = body.clientToken;
                console.log(("[Auth] (#" + account.id + ") AccessToken: " + body.accessToken).debug);
                account.accessToken = body.accessToken;
                account.accessTokenExpiration = Math.round(Date.now() / 1000) + 86360;
                account.accessTokenSource = "login_mojang";
                account.requestServer = config.server;
                console.log(("[Auth] (#" + account.id + ") RequestServer set to " + config.server));
                account.save(function (err, account) {
                    cb(null, account);
                })
            })
        }, 8000);
    };

    console.log(("[Auth] (#" + account.id + ") Authenticating account #" + account.id).info);
    if (account.clientToken && account.accessToken) {
        function refresh() {
            console.info("[Auth] (#" + account.id + ") Refreshing tokens");
            console.debug("[Auth] POST " + urls.refresh);
            var body = {
                accessToken: account.accessToken,
                clientToken: account.clientToken,
                requestUser: true
            };
            console.log(("[Auth] " + JSON.stringify(body)).debug);
            queueRequest({
                method: "POST",
                url: urls.refresh,
                headers: {
                    "User-Agent": "Mineskin Auth",
                    "Content-Type": "application/json",
                    "X-Forwarded-For": account.requestIp,
                    "REMOTE_ADDR": account.requestIp
                },
                json: true,
                body: body
            }, function (err, response, body) {
                console.log(("[Auth] (#" + account.id + ") Refresh Body:").debug)
                console.log(("[Auth] " + JSON.stringify(body)).debug);
                if (err || response.statusCode < 200 || response.statusCode > 230 || (body && body.error)) {
                    console.log(err)
                    account.accessToken = null;
                    if (account.requestServer)
                        account.lastRequestServer = account.requestServer;
                    account.requestServer = null;
                    account.save(function (err, account) {
                        console.log(("[Auth] Couldn't refresh accessToken").debug);

                        // Login
                        // module.exports.signout(account, function (err) {
                        //     if (err) console.log((err).warn);
                        setTimeout(function () {
                            loginCallback(account);
                        }, body.error === "TooManyRequestsException" ? 10000 : 1000);
                        // })
                    })
                } else {
                    console.log("[Auth] (#" + account.id + ") got a new accessToken");

                    if (body.hasOwnProperty("selectedProfile")) {
                        account.playername = body.selectedProfile.name;
                    }

                    console.log(("[Auth] AccessToken: " + body.accessToken).debug);
                    account.accessToken = body.accessToken;
                    account.accessTokenExpiration = Math.round(Date.now() / 1000) + 86360;
                    account.accessTokenSource = "refresh_mojang";
                    if (account.requestServer)
                        account.lastRequestServer = account.requestServer;
                    account.requestServer = config.server;
                    console.log(("[Auth] (#" + account.id + ") RequestServer set to " + config.server));
                    account.save(function (err, account) {
                        console.log(("[Auth] (#" + account.id + ") Logging in with AccessToken").info);
                        cb(null, account);
                    })
                }
            })
        }

        if (account.accessTokenExpiration && account.accessTokenExpiration - Math.round(Date.now() / 1000) < 240) {
            console.log("[Auth] (#" + account.id + ") force-refreshing accessToken, since it will expire in less than 4 minutes");
            setTimeout(function () {
                refresh();
            }, 1000);
        } else if (account.microsoftAccount) {
            cb(null, account);
        } else {
            console.log("[Auth] (#" + account.id + ") validating tokens");
            console.log(("[Auth] POST " + urls.validate).debug);
            var body = {
                accessToken: account.accessToken,
                clientToken: account.clientToken,
                requestUser: true
            };
            console.log(("[Auth] " + JSON.stringify(body)).debug);
            queueRequest({
                method: "POST",
                url: urls.validate,
                headers: {
                    "User-Agent": "Mineskin Auth",
                    "Content-Type": "application/json",
                    "X-Forwarded-For": account.requestIp,
                    "REMOTE_ADDR": account.requestIp
                },
                json: true,
                body: body
            }, function (err, response, body) {
                console.log("[Auth] Validate Body:".debug)
                console.log(("" + JSON.stringify(body)).debug);
                if (err || response.statusCode < 200 || response.statusCode > 230 || (body && body.error)) {
                    console.info("[Auth] Couldn't validate tokens");
                    console.log(err);
                    setTimeout(function () {
                        refresh();
                    }, body.error === "TooManyRequestsException" ? 10000 : 1000);
                } else {
                    console.info("[Auth] Tokens are still valid!");
                    cb(null, account);
                }
            })
        }
    } else {
        console.log(("[Auth] Account (#" + account.id + ") doesn't have accessToken").debug);
        // Login
        setTimeout(function () {
            loginCallback(account);
        }, 2000);
    }
};

function notifyMissingAccessToken(account) {
    if (account.discordMessageSent) return;
    Util.postDiscordMessage("⚠️ Account #" + account.id + " just lost its access token\n" +
        "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
        "  Account Type: " + (account.microsoftAccount ? "microsoft" : "mojang") + "\n" +
        "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
        "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
        "  Linked to " + account.discordUser);

    if (account.discordUser) {
        Util.sendDiscordDirectMessage("Hi there!\n" +
            "This is an automated notification that a MineSkin lost access to an account you linked to your Discord profile and has been disabled\n" +
            "  Affected Account: " + (account.playername || account.uuid) + " (" + account.username.substr(0, 4) + "****)\n" +
            "  Account Type: " + (account.microsoftAccount ? "microsoft" : "mojang") + "\n" +
            "  Last Error Code:  " + account.lastErrorCode + "\n" +
            "\n" +
            "The account won't be used for skin generation until the issues are resolved.\n" +
            "Please log back in to your account at https://mineskin.org/account\n" +
            "For further assistance feel free to ask in <#482181024445497354> 🙂", account.discordUser);
    }
    account.discordMessageSent = true;
}

module.exports.completeChallenges = function (account, cb) {
    return module.exports.completeChallengesMojang(account, cb);
}

module.exports.completeChallengesMojang = function (account, cb) {
    if ((!account.security || account.security.length === 0) && (!account.multiSecurity || account.multiSecurity.length < 3)) {
        console.log("[Auth] (#" + account.id + ") Skipping security questions as there are no answers configured");
        // No security questions set
        cb(account);
        return;
    }

    // Check if we can access
    console.log(("[Auth] GET " + urls.security.location).debug);
    queueRequest({
        url: urls.security.location,
        headers: {
            "User-Agent": "Mineskin Auth",
            "Content-Type": "application/json",
            "Authorization": "Bearer " + account.accessToken,
            "X-Forwarded-For": account.requestIp,
            "REMOTE_ADDR": account.requestIp
        }
    }, function (err, response, body) {
        if (err) return console.log(err);

        if (!response || response.statusCode < 200 || response.statusCode > 230) {// Not yet answered
            console.log(("[Auth] (#" + account.id + ") Completing challenges").debug);
            console.log(account.security.debug);

            // Get the questions
            queueRequest({
                url: urls.security.challenges,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + account.accessToken,
                    "X-Forwarded-For": account.requestIp,
                    "REMOTE_ADDR": account.requestIp
                }
            }, function (err, response, body) {
                if (err) return console.log(err);
                console.log("[Auth] Challenges:");
                console.log(body);

                var questions = JSON.parse(body);
                var answers = [];
                if (questions && questions.length > 0) {
                    console.log(typeof questions);
                    if (account.multiSecurity) {
                        var answersById = {};
                        account.multiSecurity.forEach(function (answer) {
                            answersById[answer.id] = answer.answer;
                        });
                        questions.forEach(function (question) {
                            if (!answersById.hasOwnProperty(question.answer.id)) {
                                console.warn("Missing security answer for question " + question.question.id + "(" + question.question.question + "), Answer #" + question.answer.id);
                            }
                            answers.push({id: question.answer.id, answer: answersById[question.answer.id] || account.security});
                        });
                    } else {
                        questions.forEach(function (question) {
                            answers.push({id: question.answer.id, answer: account.security});
                        });
                    }
                } else {
                    console.log(("[Auth] Got empty security questions object").warn)
                    // I'm guessing this means that there are no questions defined in the account,
                    //  though I'm not sure what kind of response the API expects here (since the access was denied in order to even get here)
                    cb(null, body);
                    return;
                }

                console.log("[Auth] Sending Challenge Answers:");
                console.log(JSON.stringify(answers).debug);

                setTimeout(function () {
                    // Post answers
                    console.log(("[Auth] POST " + urls.security.location).debug);
                    queueRequest({
                        method: "POST",
                        url: urls.security.location,
                        headers: {
                            "User-Agent": "Mineskin Auth",
                            "Content-Type": "application/json",
                            "Authorization": "Bearer " + account.accessToken,
                            "X-Forwarded-For": account.requestIp,
                            "REMOTE_ADDR": account.requestIp
                        },
                        json: answers
                    }, function (err, response, body) {
                        if (err) return console.log(err);

                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            console.log("[Auth] (#" + account.id + ") challenges completed");
                            // Challenges completed
                            cb(account);
                        } else {
                            console.log(("[Auth] (#" + account.id + ") Failed to complete security challenges").warn);
                            console.log(("" + JSON.stringify(body)).warn);
                            cb(null, body);
                        }
                    })
                }, 1000);
            })
        } else {
            cb(account);
        }
    })
}

module.exports.signout = function (account, cb) {
    return module.exports.signoutMojang(account, cb);
}

module.exports.signoutMojang = function (account, cb) {
    // ygg.signout(account.username, Util.crypto.decrypt(account.passwordNew), account.requestIp, cb);
    account.accessToken = null;
    if (account.requestServer)
        account.lastRequestServer = account.requestServer;
    account.requestServer = null;
    // account.clientToken = null;
    console.log(("[Auth] POST " + urls.signout).debug);
    queueRequest({
        method: "POST",
        url: urls.signout,
        headers: {
            "User-Agent": "Mineskin Auth",
            "Content-Type": "application/json",
            "X-Forwarded-For": account.requestIp,
            "REMOTE_ADDR": account.requestIp
        },
        json: true,
        body: {
            username: account.username,
            password: Util.crypto.decrypt(account.passwordNew)
        }
    }, function (err, response, body) {
        console.log("Signout Body:".debug)
        console.log(("" + JSON.stringify(body)).debug);
        if (err) {
            cb(err);
            return console.log(err);
        }

        cb();
    })
};
