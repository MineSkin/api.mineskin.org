const http = require('http');
const fs = require('fs');
const readChunk = require('read-chunk');
const fileType = require("file-type");
const imageSize = require("image-size");
const config = require("./config");
const crypto = require("crypto");
const request = require("request");

// Schemas
const Account = require("./db/schemas/account").Account;
const Skin = require("./db/schemas/skin").Skin;
const Traffic = require("./db/schemas/traffic").Traffic;
const Stat = require("./db/schemas/stat").Stat;

module.exports = {}

module.exports.checkTraffic = function (req, res) {
    return new Promise(function (fullfill) {
        const ip = req.realAddress;
        console.log(("IP: " + ip).debug);

        module.exports.getGeneratorDelay().then(function (delay) {
            Traffic.findOne({ip: ip}).lean().exec(function (err, traffic) {
                if (err) return console.log(err);
                if (!traffic) {// First request
                    fullfill(true, delay);
                } else {
                    const time = Date.now() / 1000;

                    if ((traffic.lastRequest.getTime() / 1000) > time - delay) {
                        res.status(429).json({error: "Too many requests", nextRequest: time + delay + 10, delay: delay});
                        fullfill(false, delay);
                    } else {
                        fullfill(true, delay);
                    }

                }
            })
        })
    })
};

module.exports.validateImage = function (req, res, file) {
    const stats = fs.statSync(file);
    const size = stats.size;
    if (size <= 0 || size > 16000) {
        res.status(400).json({error: "Invalid file size (" + size + ")"});
        return false;
    }

    try {
        const dimensions = imageSize(file);
        console.log(("Dimensions: " + JSON.stringify(dimensions)).debug);
        if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
            res.status(400).json({error: "Invalid skin dimensions. Must be 64x32 or 64x64. (Were " + dimensions.width + "x" + dimensions.height + ")"});
            return false;
        }
    } catch (e) {
        console.log(e)
        res.status(500).json({error: "Failed to get image dimensions", err: e});
        return;
    }

    const imageBuffer = readChunk.sync(file, 0, 4100);
    const type = fileType(imageBuffer);
    if (!type || type.ext !== "png" || type.mime !== "image/png") {
        res.status(400).json({error: "Invalid image type. Must be PNG. (Is " + type.ext + " / " + type.mime + ")"});
        return false;
    }

    return true;
};


module.exports.getGeneratorDelay = function () {
    return new Promise(function (fullfill, reject) {
        Account.count({enabled: true}, function (err, count) {
            if (err) return console.log(err);

            const delay = Math.round(config.generateDelay / Math.max(1, count));
            fullfill(delay);
        })
    })
};

module.exports.skinToJson = function (skin, delay, req) {
    const d = {
        id: skin.id,
        idStr: "" + skin.id,
        name: skin.name,
        model: skin.model,
        data: {
            uuid: skin.uuid,
            texture: {
                value: skin.value,
                signature: skin.signature,
                url: skin.url,
                urls: {
                    skin: skin.url,
                    cape: skin.capeUrl
                }
            }
        },
        timestamp: Math.round(skin.time),
        duration: skin.generateDuration,
        accountId: skin.account,
        server: skin.server,
        private: (skin.visibility !== 0),
        views: skin.views,
        nextRequest: delay || 0
    };
    if (req) {
        if (!req.headers["user-agent"] || req.headers["user-agent"].startsWith("Java/") || req.headers["user-agent"].startsWith("unirest")) {
            d._comment = "Please use a custom User-Agent header.";
        }
    }
    return d;
};

// https://coderwall.com/p/_g3x9q/how-to-check-if-javascript-object-is-empty
module.exports.isEmpty = function (obj) {
    for (let key in obj) {
        if (obj.hasOwnProperty(key))
            return false;
    }
    return true;
};

module.exports.validateModel = function (model) {
    if (!model) return model;
    model = model.toLowerCase();

    if (model === "default" || model === "steve" || model === "classic") {
        return "steve";
    }
    if (model === "slim" || model === "alex") {
        return "slim";
    }

    return model;
};

module.exports.postDiscordMessage = function (content, channel, fallback) {
    if (!config.discord || !config.discord.token) return;
    if (!channel) channel = config.discord.channel;
    request({
        method: "POST",
        url: "https://discordapp.com/api/channels/" + channel + "/messages",
        headers: {
            "Authorization": "Bot " + config.discord.token,
            "User-Agent": "MineSkin"
        },
        json: {
            content: content
        }
    }, function (err, res, body) {
        if (err) {
            console.warn(err);
            return;
        }
        if (res.statusCode !== 200) {
            console.warn("postDiscordMessage");
            console.warn(res.statusCode);
            console.warn(body);
            if (fallback) {
                fallback();
            }
        }
    })
};

module.exports.sendDiscordDirectMessage = function (content, receiver, fallback) {
    if (!config.discord || !config.discord.token) return;
    request({
        method: "POST",
        url: "https://discordapp.com/api/users/@me/channels",
        headers: {
            "Authorization": "Bot " + config.discord.token,
            "User-Agent": "MineSkin"
        },
        json: {
            recipient_id: receiver
        }
    }, function (err, res, body) {
        if (err) {
            console.warn(err);
            return;
        }
        if (res.statusCode !== 200) {
            console.warn("sendDiscordDirectMessage")
            console.warn(res.statusCode);
            console.warn(body);
            if (fallback) {
                fallback();
            }
        } else {
            module.exports.postDiscordMessage(content, body.id, fallback);
        }
    })
};

module.exports.increaseStat = function (key, amount, cb) {
    if (!amount) amount = 1;

    Stat.findOne({key: key}, function (err, stat) {
        if (err) return console.log(err);
        if (!stat) {
            return console.warn("Invalid Stat key: " + key);
        }
        stat.value += amount;
        stat.save(cb);
    });
};

module.exports.getVia = function (req) {
    let via = "api";
    if (req.headers["referer"]) {
        if (req.headers["referer"].indexOf("mineskin.org") > -1) {
            via = "website";
            if (req.headers["referer"].indexOf("bulk") > -1) {
                via = "website-bulk";
            }
        }
    }
    return via;
};

module.exports.crypto = require("./encryption");
