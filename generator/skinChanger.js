var request = require('request');
// request.debug=true;
var urls = require("./urls");
var fs = require("fs");
var authentication = require("./authentication");
var randomip = require("random-ip");

// Schemas
var Account = require("../db/schemas/account").Account;
var Skin = require("../db/schemas/skin").Skin;
var Traffic = require("../db/schemas/traffic").Traffic;

module.exports = {};

module.exports.findExistingSkin = function (hash, name, model, visibility, cb) {
    Skin.findOne({hash: hash, name: name, model: model, visibility: visibility}).exec(function (err, skin) {
        if (err) return console.log(err);
        if (skin) {
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
    var time = Date.now() / 1000;
    Account.findOne({enabled: true, lastUsed: {'$lt': (time - 30)}}).sort({lastUsed: 1, errorCounter: 1}).exec(function (err, account) {
        if (err) return console.log(err);
        if (!account) {
            console.log(("[SkinChanger] There are no accounts available!").error);
            res.status(500).json({error: "No accounts available"});
        } else {
            // if (time - account.lastUsed > 3600) {// Reset tokens after 30 minutes
            //     account.accessToken = null;
            //     // account.clientToken = null;
            // }
            account.lastUsed = time;
            account.save();

            cb(account);
        }
    })
}

module.exports.generateUrl = function (account, url, model, cb) {
    console.log(("[SkinChanger] Generating Skin from URL").info);
    console.log(("" + url).debug);

    account.requestIp = randomip('0.0.0.0', 0);
    console.log(("Using ip " + account.requestIp).debug);

    authentication.authenticate(account, function (authErr, authResult) {
        if (!authErr && authResult) {
            authentication.completeChallenges(account, function (result) {
                if (result) {
                    request({
                        method: "POST",
                        url: urls.skin.replace(":uuid", account.uuid),
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Authorization": "Bearer " + account.accessToken,
                            "X-Forwarded-For": account.requestIp,
                            "REMOTE_ADDR": account.requestIp
                        },
                        form: {
                            model: model,
                            url: url
                        }
                    }, function (err, response, body) {
                        if (err) return console.log(err);
                        console.log(("" + body).debug);
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            cb(true);
                        } else {
                            cb(response.statusCode);
                            console.log(("Got response " + response.statusCode + " for generateUrl").warn);
                        }
                    })
                } else {
                    account.errorCounter++;
                    account.save(function (err, account) {
                        cb("Challenges failed");
                    });
                }
            })
        } else {
            account.errorCounter++;
            account.save(function (err, account) {
                cb("Authentication failed - " + authErr.errorMessage);
            });
        }
    })
}

// 'fileBuf' must be a buffer
module.exports.generateUpload = function (account, fileBuf, model, cb) {
    console.log(("[SkinChanger] Generating Skin from Upload").info);

    account.requestIp = randomip('0.0.0.0', 0);
    console.log(("Using ip " + account.requestIp).debug);

    authentication.authenticate(account, function (authErr, authResult) {
        if (!authErr && authResult) {
            authentication.completeChallenges(account, function (result) {
                if (result) {
                    request({
                        method: "PUT",
                        url: urls.skin.replace(":uuid", account.uuid),
                        headers: {
                            "Content-Type": "multipart/form-data",
                            "Authorization": "Bearer " + account.accessToken,
                            "X-Forwarded-For": account.requestIp,
                            "REMOTE_ADDR": account.requestIp
                        },
                        formData: {
                            model: model,
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
                        console.log(("" + body).debug);
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            cb(true);
                        } else {
                            cb(response.statusCode);
                            console.log(("Got response " + response.statusCode + " for generateUpload").warn);
                        }
                    });
                } else {
                    account.errorCounter++;
                    account.save(function (err, account) {
                        console.log(("Challenges failed").warn);
                        cb("Challenges failed");
                    });
                }
            })
        } else {
            account.errorCounter++;
            account.save(function (err, account) {
                cb("Authentication failed - " + authErr.errorMessage);
            });
        }
    })
}



