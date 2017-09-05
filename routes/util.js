module.exports = function (app) {

    var https = require("https");
    var request = require("request");

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;


    app.get("/validate/user/:name", function (req, res) {
        request("https://api.mojang.com/users/profiles/minecraft/" + req.params.name, function (err, response, body) {
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
                }
            }

            res.json(result);
        });
    });

    app.get("/validate/currentUsername/:uuid",function (req,res) {
        request("https://api.mojang.com/user/profiles/" + req.params.uuid + "/names", function (err, response, body) {
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
                }
            }

            res.json(result);
        });
    })

}