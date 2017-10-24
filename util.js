var http = require('http');
var fs = require('fs');
var readChunk = require('read-chunk');
var fileType = require("file-type");
var imageSize = require("image-size");
var config = require("./config");
var crypto = require("crypto");

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
            Traffic.findOne({ip: ip}, function (err, traffic) {
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
}


module.exports.getGeneratorDelay = function () {
    return new Promise(function (fullfill, reject) {
        Account.count({enabled: true}, function (err, count) {
            if (err) return console.log(err);

            var delay = Math.round(60 / Math.max(1, count));
            fullfill(delay);
        })
    })
};

module.exports.skinToJson = function (skin, delay) {
    return {
        id: skin.id,
        name: skin.name,
        data: {
            uuid: skin.uuid,
            texture: {
                value: skin.value,
                signature: skin.signature,
                url: skin.url,
                urls:{
                    skin:skin.url,
                    cape:skin.capeUrl
                }
            }
        },
        timestamp: skin.time,
        duration: skin.generateDuration,
        accountId: skin.account,
        private: (skin.visibility !== 0),
        views: skin.views,
        nextRequest: delay || 0
    }
};

module.exports.crypto = require("./encryption");
