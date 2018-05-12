module.exports = function (app) {

    var remoteFileSize = require("remote-file-size");
    var Util = require("../util");
    var http = require('http');
    var https = require('https');
    var fs = require('fs');
    var fileType = require("file-type");
    var imageSize = require("image-size");
    var tmp = require("tmp");
    tmp.setGracefulCleanup();
    var md5 = require("md5");
    var uuid = require("uuid/v4");
    var mongoose = require("mongoose");
    var request = require("request");


    var authentication = require("../generator/authentication");
    var dataFetcher = require("../generator/dataFetcher");
    var skinChanger = require("../generator/skinChanger");

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;
    var Stat = require("../db/schemas/stat").Stat;


    app.post("/generate/url", function (req, res) {
        var url = req.body.url || req.query.url;
        var model = req.body.model || req.query.model || "steve";
        var visibility = parseInt(req.body.visibility || req.query.visibility) || 0;
        var name = req.body.name || req.query.name || "";

        console.log(req.body)
        console.log(req.query)

        console.log(("URL:        " + url).debug);
        console.log(("Model:      " + model).debug);
        console.log(("Visibility: " + visibility).debug);
        console.log(("Name:       " + name).debug);

        if (!url) {
            res.status(400).json({error: "URL is required"});
            return;
        }

        var genStart = Date.now();

        Util.checkTraffic(req, res).then(function (allowed, generatorDelay) {
            if (!allowed) return;

            remoteFileSize(url, function (err, remoteSize) {
                if (err) /*return*/ console.log(err);
                if (remoteSize <= 0 || remoteSize > 102400) {
                    res.status(400).json({error: "Invalid file size"});
                    return;
                }

                tmp.file(function (err, path, fd, fileCleanup) {
                    if (err) throw err;

                    // var file = fs.createWriteStream(path);
                    request(url, {"encoding": "binary"}, function (err, response, body) {
                        if (err) {
                            fileCleanup();
                            fs.close(fd);
                            return console.log(err);
                        }
                        if (response.statusCode !== 200) {
                            res.status(500).json({"error": "Failed to download image", code: response.statusCode});
                            fileCleanup();
                            fs.close(fd);
                            return;
                        }
                        fs.writeFile(fd, response.body, "binary", function (err) {
                            if (err) {
                                fileCleanup();
                                fs.close(fd);
                                return console.log(err);
                            }
                            fs.readFile(path, function (err, buf) {
                                if (err) {
                                    fileCleanup();
                                    fs.close(fd);
                                    return console.log(err);
                                }
                                var fileHash = md5(buf);
                                console.log("Hash: " + fileHash)

                                skinChanger.findExistingSkin(fileHash, name, model, visibility, function (existingSkin) {
                                    if (existingSkin) {
                                        res.json(Util.skinToJson(existingSkin, generatorDelay));
                                    } else {
                                        var validImage = Util.validateImage(req, res, path);
                                        // cleanup();
                                        if (validImage) {
                                            skinChanger.getAvailableAccount(req, res, function (account) {
                                                Traffic.update({ip: req.realAddress}, {lastRequest: new Date()}, {upsert: true}, function (err, traffic) {
                                                    if (err) {
                                                        fileCleanup();
                                                        fs.close(fd);
                                                        return console.log(err);
                                                    }
                                                    skinChanger.generateUrl(account, url, model, function (result) {
                                                        fs.close(fd);
                                                        fileCleanup();
                                                        if (result === true) {
                                                            account.errorCounter = 0;
                                                            if (!account.successCounter) account.successCounter = 0;
                                                            account.successCounter++;
                                                            account.save(function (err, account) {
                                                                if (err) return console.log(err);
                                                                getAndSaveSkinData(account, {
                                                                    type: "url",
                                                                    model: model,
                                                                    visibility: visibility,
                                                                    name: name,
                                                                    via: (req.headers["referer"] && req.headers["referer"].indexOf("mineskin.org") > -1) ? "website" : "api",
                                                                    ua: req.headers["user-agent"]
                                                                }, fileHash, uuid(), genStart, function (err, skin) {
                                                                    if (err) {
                                                                        res.status(500).json({error: "Failed to get skin data", err: err, accountId: account.id});
                                                                        console.log(("Failed to download skin data").warn)

                                                                        console.log(("=> FAIL #" + account.errorCounter + "\n").red);
                                                                        increaseStat("generate.fail");
                                                                    } else {
                                                                        res.json(Util.skinToJson(skin, generatorDelay));

                                                                        console.log("=> SUCCESS\n".green);
                                                                        increaseStat("generate.success");
                                                                    }
                                                                })
                                                            })
                                                        } else {
                                                            res.status(500).json({error: "Failed to generate skin data", err: result, accountId: account.id});
                                                            console.log(("Failed to generate skin data").warn)

                                                            console.log(("=> FAIL #" + account.errorCounter + "\n").red);
                                                            increaseStat("generate.fail");
                                                        }
                                                    })
                                                })
                                            })
                                        }
                                    }
                                })
                            })
                        })
                    });
                })
            });
        })
    })

    app.post("/generate/upload", function (req, res) {
        if (!req.files) {
            res.status(400).json({error: "Missing files"});
            return;
        }
        var model = req.body.model || req.query.model || "steve";
        var visibility = parseInt(req.body.visibility || req.query.visibility) || 0;
        var name = req.body.name || req.query.name || "";

        console.log(req.body)
        console.log(req.query)

        console.log(("FILE:       " + req.files.file).debug);
        console.log(("Model:      " + model).debug);
        console.log(("Visibility: " + visibility).debug);
        console.log(("Name:       " + name).debug);

        var fileUpload = req.files.file;
        if (!fileUpload) {
            res.status(400).json({error: "Missing file"});
            return;
        }

        var genStart = Date.now();

        Util.checkTraffic(req, res).then(function (allowed, generatorDelay) {
            if (!allowed) return;

            tmp.file(function (err, path, fd, fileCleanup) {
                if (err) throw err;

                fileUpload.mv(path, function (err) {
                    if (err) {
                        fileCleanup();
                        fs.close(fd);
                        return console.log(err);
                    }

                    fs.readFile(path, function (err, buf) {
                        if (err) {
                            fileCleanup();
                            fs.close(fd);
                            return console.log(err);
                        }
                        var fileHash = md5(buf);

                        skinChanger.findExistingSkin(fileHash, name, model, visibility, function (existingSkin) {
                            if (existingSkin) {
                                res.json(Util.skinToJson(existingSkin, generatorDelay));
                            } else {
                                var validImage = Util.validateImage(req, res, path);
                                // cleanup();
                                if (validImage) {
                                    skinChanger.getAvailableAccount(req, res, function (account) {
                                        Traffic.update({ip: req.realAddress}, {lastRequest: new Date()}, {upsert: true}, function (err, traffic) {
                                            if (err) {
                                                fileCleanup();
                                                fs.close(fd);
                                                return console.log(err);
                                            }
                                            skinChanger.generateUpload(account, buf, model, function (result) {
                                                fs.close(fd);
                                                fileCleanup();
                                                if (result === true) {
                                                    account.errorCounter = 0;
                                                    if (!account.successCounter) account.successCounter = 0;
                                                    account.successCounter++;
                                                    account.save(function (err, account) {
                                                        if (err) return console.log(err);
                                                        getAndSaveSkinData(account, {
                                                            type: "upload",
                                                            model: model,
                                                            visibility: visibility,
                                                            name: name,
                                                            via: (req.headers["referer"] && req.headers["referer"].indexOf("mineskin.org") > -1) ? "website" : "api",
                                                            ua: req.headers["user-agent"]
                                                        }, fileHash, uuid(), genStart, function (err, skin) {
                                                            if (err) {
                                                                res.status(500).json({error: "Failed to get skin data", err: err, accountId: account.id});
                                                                console.log(("Failed to download skin data").warn)

                                                                console.log(("=> FAIL #" + account.errorCounter + "\n").red);
                                                                increaseStat("generate.fail");
                                                            } else {
                                                                res.json(Util.skinToJson(skin, generatorDelay));

                                                                console.log("=> SUCCESS\n".green);
                                                                increaseStat("generate.success");
                                                            }
                                                        });
                                                    })
                                                } else {
                                                    res.status(500).json({error: "Failed to upload skin data (" + result + ")", err: result, accountId: account.id});
                                                    console.log(("Failed to upload skin data").warn)

                                                    console.log(("=> FAIL #" + account.errorCounter + "\n").red);
                                                    increaseStat("generate.fail");
                                                }
                                            })
                                        })
                                    })
                                }
                            }
                        })
                    })
                })
            })
        })
    });

    app.get("/generate/user/:uuid", function (req, res) {
        var visibility = parseInt(req.body.visibility || req.query.visibility) || 0;
        var name = req.body.name || req.query.name || "";
        var uuid = req.params.uuid;

        console.log(("USER:       " + uuid).debug);
        console.log(("Visibility: " + visibility).debug);
        console.log(("Name:       " + name).debug);

        var shortUuid = uuid;
        var longUuid = uuid;
        if (shortUuid.indexOf("-") > -1) {
            shortUuid = shortUuid.replace(/-/g, "");
        }
        if (longUuid.indexOf("-") < 0) {
            longUuid = longUuid.substring(0, 8) + "-" + longUuid.substring(8, 8 + 4) + "-" + longUuid.substring(12, 12 + 4) + "-" + longUuid.substring(16, 16 + 4) + "-" + longUuid.substring(20, 20 + 12);
        }

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(longUuid)) {
            res.status(400).json({error: "Invalid UUID"});
            return;
        }

        var genStart = Date.now();

        Util.checkTraffic(req, res).then(function (allowed, generatorDelay) {
            if (!allowed) return;
            Skin.findOne({uuid: longUuid, name: name, visibility: visibility}, function (err, skin) {
                if (err) return console.log(err);
                if (skin) {// Skin already generated
                    var time = Date.now() / 1000;
                    if (skin.time > time - 1800) {// Wait 30 minutes before generating again
                        skin.duplicate += 1;
                        skin.save(function (err, skin) {
                            if (err) return console.log(err);

                            res.json(Util.skinToJson(skin, generatorDelay));
                        })
                        return;
                    }
                }

                // Don't generate anything, just need to get the user's live skin data

                getAndSaveSkinData({uuid: shortUuid}, {
                    type: "user",
                    model: "unknown",
                    visibility: visibility,
                    name: name,
                    via: (req.headers["referer"] && req.headers["referer"].indexOf("mineskin.org") > -1) ? "website" : "api",
                    ua: req.headers["user-agent"]
                }, function (skinTexture, cb) {// Generate the file hash from the skin's texture url
                    if (!skinTexture) return;
                    tmp.file(function (err, path, fd, fileCleanup) {
                        if (err) throw err;

                        // var file = fs.createWriteStream(path);
                        request(skinTexture.url, {"encoding": "binary"}, function (err, response, body) {
                            if (err) {
                                fileCleanup();
                                fs.close(fd);
                                return console.log(err);
                            }

                            fs.write(fd, response.body, "binary", function (err) {
                                if (err) {
                                    fileCleanup();
                                    fs.close(fd);
                                    return console.log(err);
                                }
                                fs.readFile(path, function (err, buf) {
                                    if (err) return console.log(err);
                                    var fileHash = md5(buf);

                                    cb(fileHash);
                                    fs.close(fd);
                                    fileCleanup();
                                })
                            });
                        })
                    })
                }, longUuid, genStart, function (err, skin) {
                    if (err) {
                        res.status(500).json({error: "Failed to get skin data", err: err});
                        console.log(("Failed to download skin data").warn)

                        console.log(("=> FAIL\n").red);
                        increaseStat("generate.fail");
                    } else {
                        res.json(Util.skinToJson(skin, generatorDelay));

                        console.log("=> SUCCESS\n".green);
                        increaseStat("generate.success");
                    }
                })
            })
        })
    });

    // fileHash can either be the hash, or a callback to get the hash
    function getAndSaveSkinData(account, options, fileHash, uuid, genStart, cb) {
        Skin.findOne({}).sort({id: -1}).exec(function (err, last) {
            if (err) return console.log(err);
            var lastId = last.id;
            dataFetcher.getSkinData(account, function (err, skinData) {
                if (err) {
                    cb(err, null);
                    return console.log(err);
                }

                var textures = JSON.parse(new Buffer(skinData.value, 'base64').toString('utf8')).textures;
                console.log(JSON.stringify(textures).debug);
                var skinTexture = textures.SKIN;
                var capeTexture = textures.CAPE || {url: undefined};
                console.log("Skin: " + JSON.stringify(skinTexture));
                console.log("Cape: " + JSON.stringify(capeTexture))

                var fileHashCallback = function (fileHash) {
                    var skin = new Skin({
                        // '_id': mongoose.Types.ObjectId(md5(fileHash + options.name + Date.now())),
                        id: lastId + 1,
                        hash: fileHash,
                        name: options.name,
                        model: options.model,
                        visibility: options.visibility,
                        uuid: uuid,
                        value: skinData.value,
                        signature: skinData.signature,
                        url: skinTexture.url,
                        capeUrl: capeTexture.url,
                        time: Date.now() / 1000,
                        generateDuration: Date.now() - genStart,
                        account: account.id,
                        type: options.type,
                        duplicate: 0,
                        views: 1,
                        via: options.via || "api",//TODO,
                        ua: options.ua,
                        apiVer: "node"
                    });
                    skin.save(function (err, skin) {
                        if (err) return console.log(err);
                        console.log(("[Generator] New Skin saved (#" + skin.id + "). Generated in " + (Date.now() - genStart) + "ms").info);
                        cb(null, skin);
                    })
                };

                if (typeof fileHash === "function") {
                    fileHash(skinTexture, fileHashCallback);
                } else {
                    fileHashCallback(fileHash);
                }
            })
        })
    }

    function increaseStat(key, amount, cb) {
        if (!amount) amount = 1;
        Stat.findOne({key: key}, function (err, stat) {
            if (err) return console.log(err);
            if (!stat) {
                return console.warn("Invalid Stat key: " + key);
            }
            stat.value += amount;
            stat.save(cb);
        })
    };

}
