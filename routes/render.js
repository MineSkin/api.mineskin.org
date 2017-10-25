module.exports = function (app) {

    var http = require('http');
    var https = require('https');
    var request = require("request");
    var fs = require('fs');
    var tmp = require("tmp");

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;

    app.get("/render/:type(head|skin)", function (req, res) {
        var url = req.query.url;
        if (!url) {
            req.status(400).json({error: "Missing URL"});
            return;
        }
        var options = req.query.options || "&aa=true";

        doRender(req, res, url, req.params.type, options);
    })

    app.get("/render/:id/:type(head|skin)", function (req, res) {
        Skin.findOne({id: req.params.id}, function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                var options = req.query.options || "&aa=true";

                doRender(req, res, skin.url, req.params.type, options);
            } else {
                res.status(404).end();
            }
        })
    });

    // Helper route to avoid CORS issues
    app.get("/render/texture/:id", function (req, res) {
        Skin.findOne({id: req.params.id}, function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                request(skin.url).pipe(res);
            } else {
                res.status(404).end();
            }
        })
    })

    function doRender(req, res, url, type, options) {
        // request("http://tools.inventivetalent.org/skinrender/3d.php?headOnly=" + (type === "head") + "&user=" + url + options, function (err,response,body) {
        //     console.log(body)
        //      if (response.statusCode === 200) {
        //          res.writeHead(200, {
        //              "Content-Type": "image/png",
        //              "Pragma": "public",
        //              "Cache-Control": "max-age=604800",
        //              "Expires": new Date(Date.now() + 604800).toUTCString()
        //          });
        //          console.log(response.pipe)
        //          response.pipe(res)
        //      } else {
        //          res.status(response.statusCode).end();
        //      }
        //  })
        request("http://tools.inventivetalent.org/skinrender/3d.php?headOnly=" + (type === "head") + "&user=" + url + options).pipe(res);
    }

};