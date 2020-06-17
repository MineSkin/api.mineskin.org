module.exports = function (app) {

    var https = require("https");
    var request = require("request");

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;

    var userByNameCache = {};
    var nameByIdCache = {};

    module.exports.cache = {
        byName: userByNameCache,
        byId: nameByIdCache
    };

    setInterval(function () {
        for (var name in userByNameCache) {
            if ((Date.now() / 1000) - userByNameCache[name].time > 240) {
                delete userByNameCache[name];
            }
        }
        for (var id in nameByIdCache) {
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
        var name = req.params.name.toLowerCase();
        if (userByNameCache.hasOwnProperty(name)) {
            res.json(userByNameCache[name]);
            return;
        }
        request("https://api.mojang.com/users/profiles/minecraft/" + name, function (err, response, body) {
            console.log(("" + body).debug);

            var result = {
                valid: false,
                uuid: null,
                name: req.params.name
            };
            if (err) {
                console.log(err);
            } else {
                if (body) {
                    body = JSON.parse(body);
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
        var uuid = req.params.uuid.toLowerCase();
        if (nameByIdCache.hasOwnProperty(uuid)) {
            res.json(nameByIdCache[uuid]);
            return;
        }
        request("https://api.mojang.com/user/profiles/" + uuid + "/names", function (err, response, body) {
            console.log(("" + body).debug);

            var result = {
                uuid: req.params.uuid,
                name: ""
            };
            if (err) {
                console.log(err);
            } else {
                if (body) {
                    body = JSON.parse(body);
                    result.name = body[body.length - 1]["name"];

                    result.time = Date.now() / 1000;
                    nameByIdCache[uuid] = result;
                }
            }

            res.json(result);
        });
    })

}
