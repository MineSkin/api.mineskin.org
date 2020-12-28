module.exports = function (app) {

    const https = require("https");
    const request = require("request");
    const Sentry = require("@sentry/node");

    // Schemas
    const Account = require("../database/schemas/account").Account;
    const Skin = require("../database/schemas/skin").Skin;
    const Traffic = require("../database/schemas/traffic").Traffic;

    const userByNameCache = {};
    const nameByIdCache = {};

    module.exports.cache = {
        byName: userByNameCache,
        byId: nameByIdCache
    };

    setInterval(function () {
        console.log("[Util] ByName cache size: " + Object.keys(userByNameCache).length);
        console.log("[Util] ById cache size: " + Object.keys(nameByIdCache).length);

        for (let name in userByNameCache) {
            if ((Date.now() / 1000) - userByNameCache[name].time > 240) {
                delete userByNameCache[name];
            }
        }
        for (let id in nameByIdCache) {
            if ((Date.now() / 1000) - nameByIdCache[id].time > 240) {
                delete userByNameCache[id];
            }
        }
    }, 60000);

    app.get("/validate/user/:name", function (req, res) {
        if (req.params.name.length < 3) {
            res.json({error: "invalid name"});
            return;
        }
        const name = req.params.name.toLowerCase();
        if (userByNameCache.hasOwnProperty(name)) {
            res.json(userByNameCache[name]);
            return;
        }
        request("https://api.mojang.com/users/profiles/minecraft/" + name, function (err, response, body) {
            console.log(("" + body).debug);

            const result = {
                valid: false,
                uuid: null,
                name: req.params.name
            };
            if (err) {
                console.log(err);
            } else {
                if (body) {
                    try {
                        body = JSON.parse(body);
                    } catch (e) {
                        res.json({error:"failed to parse body"});
                        Sentry.captureException(e);
                        return;
                    }
                    result.valid = true;
                    result.uuid = body.id;
                    result.name = body.name;

                    result.time = Date.now() / 1000;
                    userByNameCache[body.name.toLowerCase()] = result;
                }
            }

            res.json(result);
        });
    });

    app.get("/validate/currentUsername/:uuid", function (req, res) {
        if (req.params.uuid.length < 30) {
            res.json({error: "invalid uuid"});
            return;
        }
        const uuid = req.params.uuid.toLowerCase();
        if (nameByIdCache.hasOwnProperty(uuid)) {
            res.json(nameByIdCache[uuid]);
            return;
        }
        request("https://api.mojang.com/user/profiles/" + uuid + "/names", function (err, response, body) {
            console.log(("" + body).debug);

            const result = {
                uuid: req.params.uuid,
                name: ""
            };
            if (err) {
                console.log(err);
            } else {
                if (body) {
                    try {
                        body = JSON.parse(body);
                    } catch (e) {
                        res.json({error:"failed to parse body"});
                        Sentry.captureException(e);
                        return;
                    }
                    result.name = body[body.length - 1]["name"];

                    result.time = Date.now() / 1000;
                    nameByIdCache[uuid] = result;
                }
            }

            res.json(result);
        });
    })

}
