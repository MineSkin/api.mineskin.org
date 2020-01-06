var http = require('http');
var fs = require('fs');
var readChunk = require('read-chunk');
var fileType = require("file-type");
var imageSize = require("image-size");
var config = require("./config");
var crypto = require("crypto");
var request = require("request");

// Schemas
var Account = require("./db/schemas/account").Account;
var Skin = require("./db/schemas/skin").Skin;
var Traffic = require("./db/schemas/traffic").Traffic;

module.exports = {}

module.exports.checkTraffic = function (req, res) {
    return new Promise(function (fullfill) {
        var ip = req.realAddress;
        console.log(("IP: " + ip).debug);

        module.exports.getGeneratorDelay().then(function (delay) {
            Traffic.findOne({ip: ip}).lean().exec(function (err, traffic) {
                if (err) return console.log(err);
                if (!traffic) {// First request
                    fullfill(true, delay);
                } else {
                    var time = Date.now() / 1000;

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
    var stats = fs.statSync(file);
    var size = stats.size;
    if (size <= 0 || size > 16000) {
        res.status(400).json({error: "Invalid file size (" + size + ")"});
        return false;
    }

    try {
        var dimensions = imageSize(file);
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

    var imageBuffer = readChunk.sync(file, 0, 4100);
    var type = fileType(imageBuffer);
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

            var delay = Math.round(config.generateDelay / Math.max(1, count));
            fullfill(delay);
        })
    })
};

module.exports.skinToJson = function (skin, delay) {
    return {
        id: skin.id,
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
        timestamp: skin.time,
        duration: skin.generateDuration,
        accountId: skin.account,
        server: skin.server,
        private: (skin.visibility !== 0),
        views: skin.views,
        nextRequest: delay || 0
    }
};

// https://coderwall.com/p/_g3x9q/how-to-check-if-javascript-object-is-empty
module.exports.isEmpty = function (obj) {
    for (var key in obj) {
        if (obj.hasOwnProperty(key))
            return false;
    }
    return true;
};


module.exports.postDiscordMessage = function(content, channel){
    if(!config.discord||!config.discord.token)return;
    if(!channel)channel = config.discord.channel;
    request({
        method:"POST",
        url: "https://discordapp.com/api/channels/"+channel+"/messages",
        headers:{
            "Authorization":"Bot "+config.discord.token,
            "User-Agent":"MineSkin"
        },
        json:{
            content:content
        }
    },function (err,res,body) {
        if (err) {
            console.warn(err);
            return;
        }
        if (res.statusCode !== 200) {
            console.warn(res.statusCode);
            console.warn(body);
        }
    })
};

module.exports.sendDiscordDirectMessage = function(content, receiver){
    if(!config.discord||!config.discord.token)return;
    request({
        method:"POST",
        url: "https://discordapp.com/api/users/@me/channels",
        headers:{
            "Authorization":"Bot "+config.discord.token,
            "User-Agent":"MineSkin"
        },
        json:{
            recipient_id:receiver
        }
    },function (err,res,body) {
        if (err) {
            console.warn(err);
            return;
        }
        if (res.statusCode !== 200) {
            console.warn(res.statusCode);
            console.warn(body);
        }else{
            module.exports.postDiscordMessage(content, body.id);
        }
    })
};

module.exports.crypto = require("./encryption");
