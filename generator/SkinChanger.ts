import { Config } from "../types/Config";

const config: Config = require("../config");

export class SkinChanger {


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



