module.exports = function (app) {

    var Util = require("../util");
    var skinChanger = require("../generator/skinChanger");
    var auth = require("../generator/authentication");
    var dataFetcher = require("../generator/dataFetcher")
    var config = require("../config");
    const metrics = require("../metrics");

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;
    var Stat = require("../db/schemas/stat").Stat;

    app.get("/get/delay", function (req, res) {
        var ip = req.realAddress;
        Util.getGeneratorDelay().then(function (delay) {
            Traffic.findOne({ip: ip}).lean().exec(function (err, traffic) {
                if (err) return console.log(err);
                if (traffic) {
                    res.json({delay: delay, next: (traffic.lastRequest.getTime() / 1000) + delay, nextRelative: ((traffic.lastRequest.getTime() / 1000) + delay) - (Date.now() / 1000)});
                } else {
                    res.json({delay: delay, next: Date.now() / 1000, nextRelative: 0});
                }
            })
        })
    });

    let stats = {
        server: config.server
    };

    function updateStats() {
        let start = Date.now();


        stats.queues = {
            auth: {
                delay: config.requestQueue.auth,
                size: auth.requestQueue.length
            },
            skinChanger: {
                delay: config.requestQueue.skinChanger,
                size: skinChanger.requestQueue.length
            }
        };
        stats.cache = {
            dataFetcher: Object.keys(dataFetcher.cache).length
        };

        Account.count({enabled: true}, function (err, count) {
            if (err) return console.log(err);
            stats.accounts = count;
            Account.count({enabled: true, requestServer: {$in: [null, "default", config.server]}}, function (err, serverCount) {
                if (err) return console.log(err);
                stats.serverAccounts = serverCount;
                Account.count({enabled: true, errorCounter: {$lt: (config.errorThreshold || 10)}}, function (err, healthyCount) {
                    if (err) return console.log(err);
                    stats.healthyAccounts = healthyCount;
                    var time = Date.now() / 1000;
                    Account.count({enabled: true, requestServer: {$in: [null, "default", config.server]}, lastUsed: {'$lt': (time - 100)}, forcedTimeoutAt: {'$lt': (time - 500)}, errorCounter: {'$lt': (config.errorThreshold || 10)}}, function (err, useableCount) {
                        if (err) return console.log(err);
                        stats.useableAccounts = useableCount;
                        Stat.find({}).lean().exec(function (err, s) {
                            if (err) return console.log(err);
                            var generateSuccess = 0;
                            var generateFail = 0;
                            var testerSuccess = 0;
                            var testerFail = 0;
                            s.forEach(function (stat) {
                                if (stat.key === "generate.success") generateSuccess = stat.value;
                                if (stat.key === "generate.fail") generateFail = stat.value;
                                if (stat.key === "mineskintester.success") testerSuccess = stat.value;
                                if (stat.key === "mineskintester.fail") testerFail = stat.value;
                            });
                            var generateTotal = generateSuccess + generateFail;
                            stats.successRate = Number((generateSuccess / generateTotal).toFixed(3));
                            var testerTotal = testerSuccess + testerFail;
                            stats.mineskinTesterSuccessRate = Number((testerSuccess / testerTotal).toFixed(3));

                            Skin.aggregate([
                                {"$sort": {time: -1}},
                                {"$limit": 1000},
                                {
                                    "$group": {
                                        "_id": null,
                                        "avgGenTime": {"$avg": "$generateDuration"}
                                    }
                                }
                            ], function (err, agg0) {
                                if (err) return console.log(err);

                                stats.avgGenerateDuration = agg0[0].avgGenTime;

                                Skin.aggregate([
                                    {
                                        "$group":
                                            {
                                                _id: "$type",
                                                duplicate: {$sum: "$duplicate"},
                                                views: {$sum: "$views"},
                                                count: {$sum: 1}
                                            }
                                    }
                                ], function (err, agg) {
                                    if (err) return console.log(err);
                                    var user = agg[0];
                                    var url = agg[1];
                                    var upload = agg[2];

                                    stats.genUpload = upload.count;
                                    stats.genUrl = url.count;
                                    stats.genUser = user.count;

                                    stats.unique = user.count + url.count + upload.count;

                                    stats.duplicate = user.duplicate + url.duplicate + upload.duplicate;
                                    stats.views = user.views + url.views + upload.views;
                                    stats.private = 0;
                                    stats.withNames = 0;

                                    stats.lastHour = 0;
                                    stats.lastDay = 0;
                                    stats.lastMonth = 0;
                                    stats.lastYear = 0;


                                    stats.viaApi = 0;
                                    stats.viaWebsite = 0;

                                    stats.total = stats.unique + stats.duplicate;

                                    var lastHour = new Date(new Date() - 3.6e+6) / 1000;
                                    var lastDay = new Date(new Date() - 8.64e+7) / 1000;
                                    var lastMonth = new Date(new Date() - 2.628e+9) / 1000;
                                    var lastYear = new Date(new Date() - 3.154e+10) / 1000;

                                    Skin.aggregate([
                                        {
                                            $group: {
                                                _id: null,
                                                lastYear: {$sum: {$cond: [{$gte: ["$time", lastYear]}, 1, 0]}},
                                                lastMonth: {$sum: {$cond: [{$gte: ["$time", lastMonth]}, 1, 0]}},
                                                lastDay: {$sum: {$cond: [{$gte: ["$time", lastDay]}, 1, 0]}},
                                                lastHour: {$sum: {$cond: [{$gte: ["$time", lastHour]}, 1, 0]}}
                                            }
                                        }
                                    ], function (err, agg1) {
                                        if (err) return console.log(err);

                                        stats.lastYear = agg1[0].lastYear;
                                        stats.lastMonth = agg1[0].lastMonth;
                                        stats.lastDay = agg1[0].lastDay;
                                        stats.lastHour = agg1[0].lastHour;

                                        //DONE

                                        console.log("Stats update took " + ((Date.now() - start) / 1000) + "s");

                                        try {
                                            metrics.influx.writePoints([
                                                {
                                                    measurement: 'mineskin.accounts',
                                                    tags: {
                                                        server: config.server
                                                    },
                                                    fields: {
                                                        total: stats.accounts,
                                                        totalServer: stats.serverAccounts,
                                                        healthy: stats.healthyAccounts,
                                                        useable: stats.useableAccounts
                                                    }
                                                },
                                                {
                                                    measurement: 'mineskin.skins',
                                                    fields: {
                                                        total: stats.total,
                                                        unique: stats.unique,
                                                        duplicate: stats.duplicate
                                                    }
                                                }
                                            ], {
                                                database: 'metrics'
                                            })
                                        } catch (e) {
                                            console.warn(e);
                                        }
                                    });
                                })
                            })
                        })
                    })
                })
            })
        })
    }

    setInterval(() => updateStats(), 60000);

    app.get("/get/stats/:details?", function (req, res) {
        Util.getGeneratorDelay().then(function (delay) {
            stats.delay = delay;

            res.json(stats);
        })
    });


    function buildSkinStats(skins) {
        var lastHour = new Date(new Date() - 3.6e+6) / 1000;
        var lastDay = new Date(new Date() - 8.64e+7) / 1000;
        var lastMonth = new Date(new Date() - 2.628e+9) / 1000;
        var lastYear = new Date(new Date() - 3.154e+10) / 1000;

        var stats = {};

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

        var totalDuration = 0;
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

            if (skin.generateDuration)
                totalDuration += skin.generateDuration;
        });
        stats.total = stats.unique + stats.duplicate;

        stats.avgDuration = Number((totalDuration / skins.length).toFixed(4));

        return stats;
    }

    app.get("/get/id/:id", function (req, res) {
        Skin.findOne({id: req.params.id}).exec(function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                skin.views += 1;
                if (skin.model === "alex") {
                    skin.model = "slim";
                }
                skin.save(function (err, skin) {
                    if (err) return console.log(err);
                    res.json(Util.skinToJson(skin, 0, req));
                });
            } else {
                res.status(404).json({error: "Skin not found"});
            }
        })
    });

    app.get("/get/forTexture/:value/:signature?", function (req, res) {
        var search = {value: req.params.value};
        if (req.params.signature) {
            search.signature = req.params.signature;
        }
        Skin.findOne(search, function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                res.json(Util.skinToJson(skin, 0, req));
            } else {
                res.status(404).json({error: "Skin not found"});
            }
        });
    });

    app.get("/get/list/:page?", function (req, res) {
        var page = Math.max(req.params.page || 1, 1);
        var size = Math.max(req.query.size || 16, 1);
        size = Math.min(64, size);
        var sort = req.query.sort || -1;

        var query = {visibility: 0};
        if (req.query.filter && req.query.filter.length > 0) {
            query.name = {'$regex': ".*" + req.query.filter + ".*"};
        }
        if (req.query.cape) {
            if (req.query.cape === "true") {
                query.capeUrl = {'$ne': null};
            } else if (req.query.cape === "false") {
                query.capeUrl = {'$eq': null};
            }
        }
        Skin.count(query, function (err, count) {
            if (err) return console.log(err);
            Skin
                .find(query)
                .skip(size * (page - 1))
                .limit(size)
                .select({'_id': 0, id: 1, name: 1, url: 1, time: 1})
                .sort({time: sort})
                .lean()
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
        });

    })

};
