module.exports = function (app) {

    var Util = require("../util");
    var skinChanger = require("../generator/skinChanger");

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;
    var Stat = require("../db/schemas/stat").Stat;

    app.get("/get/delay", function (req, res) {
        var ip = req.realAddress;
        Util.getGeneratorDelay().then(function (delay) {
            Traffic.findOne({ip: ip}, function (err, traffic) {
                if (err) return console.log(err);
                if (traffic) {
                    res.json({delay: delay, next: (traffic.lastRequest.getTime() / 1000) + delay, nextRelative: ((traffic.lastRequest.getTime() / 1000) + delay) - (Date.now() / 1000)});
                } else {
                    res.json({delay: delay, next: Date.now() / 1000, nextRelative: 0});
                }
            })
        })
    })

    app.get("/get/stats/:details?", function (req, res) {
        var stats = {};

        var lastHour = new Date(new Date() - 3.6e+6) / 1000;
        var lastDay = new Date(new Date() - 8.64e+7) / 1000;
        var lastMonth = new Date(new Date() - 2.628e+9) / 1000;
        var lastYear = new Date(new Date() - 3.154e+10) / 1000;

        Util.getGeneratorDelay().then(function (delay) {
            stats.delay = delay;

            Skin.find({}, "duplicate views visibility time name type via", function (err, skins) {
                if (err) return console.log(err);
                stats.unique = skins.length;

                stats.duplicate = 0;
                stats.views = 0;
                stats.private = 0;
                stats.withNames = 0;

                stats.lastHour = 0;
                stats.lastDay = 0;
                stats.lastMonth = 0;
                stats.lastYear = 0;

                stats.genUpload = 0;
                stats.genUrl = 0;
                stats.genUser = 0;

                stats.viaApi = 0;
                stats.viaWebsite = 0;


                skins.forEach(function (skin) {
                    stats.duplicate += skin.duplicate;
                    stats.views += skin.views;
                    if (skin.visibility !== 0) stats.private++;
                    if (skin.name && skin.name.length > 0) stats.withNames++;

                    if (skin.time > lastHour) stats.lastHour++;
                    if (skin.time > lastDay) stats.lastDay++;
                    if (skin.time > lastMonth) stats.lastMonth++;
                    if (skin.time > lastYear) stats.lastYear++;

                    if (skin.type === "upload") stats.genUpload++;
                    if (skin.type === "url") stats.genUrl++;
                    if (skin.type === "user") stats.genUser++;

                    if (skin.via === "api") stats.viaApi++;
                    if (skin.via === "website") stats.viaWebsite++;
                })
                stats.total = stats.unique + stats.duplicate;

                Account.count({enabled: true}, function (err, count) {
                    if (err) return console.log(err);
                    stats.accounts = count;

                    Stat.find({}, function (err, s) {
                        var generateSuccess = 0;
                        var generateFail = 0;
                        s.forEach(function (stat) {
                            if (stat.key === "generate.success") generateSuccess = stat.value;
                            if (stat.key === "generate.fail") generateFail = stat.value;
                        })

                        var generateTotal = generateSuccess + generateFail;
                        stats.successRate = Number((generateSuccess / generateTotal).toFixed(3));

                        res.json(stats);
                    })
                })
            })
        })
    })

    app.get("/get/id/:id", function (req, res) {
        Skin.findOne({id: req.params.id}, function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                skin.views += 1;
                skin.save(function (err, skin) {
                    if (err) return console.log(err);
                    res.json(Util.skinToJson(skin, 0));
                })
            } else {
                res.status(404).json({error: "Skin not found"});
            }
        })
    })

    app.get("/get/list/:page?", function (req, res) {
        var page = Math.max(req.params.page || 1, 1);
        var size = Math.max(req.query.size || 16, 1);
        var sort = req.query.sort || -1;

        var query = {visibility: 0};
        if (req.query.filter) {
            query.name = {'$regex': ".*" + req.query.filter + ".*"};
        }
        Skin.count(query, function (err, count) {
            if (err) return console.log(err);
            Skin
                .find(query)
                .skip(size * (page - 1))
                .limit(size)
                .select({'_id': 0, id: 1, name: 1, url: 1})
                .sort({id: sort})
                .exec(function (err, skins) {
                    if (err) return console.log(err)

                    res.json({
                        skins: skins,
                        page: {
                            index: page,
                            amount: Math.round(count / size),
                            total: count
                        },
                        filter: req.query.filter
                    })
                })
        })

    })

};