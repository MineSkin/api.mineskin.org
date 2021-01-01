module.exports = function (app) {

    const http = require('http');
    const https = require('https');
    const request = require("request");
    const fs = require('fs');
    const tmp = require("tmp");

    // Schemas
    const Account = require("../database/schemas/Account").IAccountDocument;
    const Skin = require("../database/schemas/Skin").ISkinDocument;
    const Traffic = require("../database/schemas/Traffic").ITrafficDocument;

    app.get("/render/:type(head|skin)", function (req, res) {
        const url = req.query.url;
        if (!url) {
            res.status(400).json({error: "Missing URL"});
            return;
        }
        const options = req.query.options || "&aa=true";

        doRender(req, res, url, req.params.type, options);
    })

    app.get("/render/:id/:type(head|skin)", function (req, res) {
        Skin.findOne({id: req.params.id}).lean().exec( function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                const options = req.query.options || "&aa=true";

                doRender(req, res, skin.url, req.params.type, options);
            } else {
                res.status(404).end();
            }
        })
    });

    // Helper route to avoid CORS issues
    app.get("/render/texture/:id", function (req, res) {
        Skin.findOne({id: req.params.id}).lean().exec( function (err, skin) {
            if (err) return console.log(err);
            if (skin) {
                request(skin.url).pipe(res);
            } else {
                res.status(404).end();
            }
        })
    });

    app.get("/render/texture/:id/cape", function (req, res) {
        Skin.findOne({id: req.params.id}).lean().exec( function (err, skin) {
            if (err) return console.log(err);
            if (skin && skin.capeUrl) {
                request(skin.capeUrl).pipe(res);
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
        request("https://tools.inventivetalent.org/skinrender/3d.php?headOnly=" + (type === "head") + "&user=" + url + options).pipe(res);
    }

};
