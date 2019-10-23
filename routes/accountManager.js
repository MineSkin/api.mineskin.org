module.exports = function (app, config) {

    var util = require("../util");
    var urls = require("../generator/urls");
    var request = require("request").defaults({
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate",
            "Origin": "mojang://launcher",
            "User-Agent": "MineSkin.org" /*"Minecraft Launcher/2.1.2481 (bcb98e4a63) Windows (10.0; x86_64)"*/,
            "Content-Type": "application/json;charset=UTF-8"
        }
    });
    var md5 = require("md5");

    var pendingDiscordLinks = {};

    // Schemas
    var Account = require("../db/schemas/account").Account;


    app.get("/accountManager/myAccount", function (req, res) {
        if (!req.query.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }
        if (!req.query.username) {
            res.status(400).json({error: "Missing login data"});
            return;
        }

        Account.findOne({username: req.query.username, type: "external"}, "username uuid lastUsed enabled hasError lastError successCounter errorCounter").lean().exec(function (err, account) {
            if (err) return console.log(err);
            if (!account) {
                res.status(404).json({error: "Account not found"})
                return;
            }

            getUser(req.query.token, function (response, body) {
                if (body.error) {
                    res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
                } else {
                    if (body.username !== req.query.username) {
                        res.status(400).json({error: "username mismatch"})
                        return;
                    }

                    var generateTotal = account.successCounter + account.errorCounter;
                    res.json({
                        username: account.username,
                        uuid: account.uuid,
                        lastUsed: account.lastUsed,
                        enabled: account.enabled,
                        hasError: account.hasError,
                        lastError: account.lastError,
                        successRate: Number((account.successCounter / generateTotal).toFixed(3))
                    })
                }
            })
        });

    });

    app.post("/accountManager/auth/login", function (req, res) {
        if (!req.body.username || !req.body.password) {
            res.status(400).json({error: "Missing login data"});
            return;
        }
        var remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        console.log(("[Auth] POST " + urls.authenticate).debug);
        var body = {
            agent: {
                name: "Minecraft",
                version: 1
            },
            username: req.body.username,
            password: new Buffer(req.body.password, "base64").toString("ascii"),
            clientToken: md5(req.body.username + "_" + remoteIp),
            requestUser: true
        };
        console.log(("[Acc] " + JSON.stringify(body)).debug);
        request({
            method: "POST",
            url: urls.authenticate,
            headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": remoteIp,
                "REMOTE_ADDR": remoteIp
            },
            json: true,
            body: body
        }, function (err, response, body) {
            console.log("Auth Body:".debug)
            console.log(("" + JSON.stringify(body)).debug);
            if (err) {
                res.status(500).json({error: body})
                return console.log(err);
            }
            if (body.error) {
                console.error(body);
                res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
            } else {
                res.json({
                    success: !!body.accessToken,
                    token: body.accessToken
                })
            }
        })
    });

    app.post("/accountManager/auth/solveChallenges", function (req, res) {
        if (!req.body.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }
        if (!req.body.securityAnswer) {
            res.status(400).json({error: "Missing security answer"})
            return;
        }
        var remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        console.log(("[Auth] GET " + urls.security.location).debug);
        request({
            url: urls.security.location,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + req.body.token,
                "X-Forwarded-For": remoteIp,
                "REMOTE_ADDR": remoteIp
            }
        }, function (err, response, body) {
            if (err) return console.log(err);

            if (!response || response.statusCode < 200 || response.statusCode > 230) {// Not yet answered
                // Get the questions
                console.log(("[Auth] GET " + urls.security.challenges).debug);
                request({
                    url: urls.security.challenges,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + req.body.token,
                        "X-Forwarded-For": remoteIp,
                        "REMOTE_ADDR": remoteIp
                    }
                }, function (err, response, body) {
                    if (err) return console.log(err);

                    var questions = JSON.parse(body);
                    var answers = [];
                    if (questions) {
                        console.log(questions);
                        questions.forEach(function (question) {
                            answers.push({id: question.answer.id, answer: req.body.securityAnswer});
                        });
                    }

                    // Post answers
                    console.log(("[Auth] POST " + urls.security.location).debug);
                    request({
                        method: "POST",
                        url: urls.security.location,
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": "Bearer " + req.body.token,
                            "X-Forwarded-For": remoteIp,
                            "REMOTE_ADDR": remoteIp
                        },
                        json: answers
                    }, function (err, response, body) {
                        if (err) return console.log(err);

                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            res.json({
                                success: true,
                                status: "ok",
                                msg: "Challenges solved"
                            })
                        } else {
                            res.json({
                                success: false,
                                status: "err",
                                error: body.error,
                                msg: body.errorMessage
                            })
                        }
                    })
                })
            } else {
                res.json({
                    success: true,
                    status: "ok",
                    msg: "Challenges already solved"
                })
            }
        })
    })

    app.get("/accountManager/auth/user", function (req, res) {
        if (!req.query.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }

        getUser(req.query.token, function (response, body) {
            if (body.error) {
                console.error(body);
                res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
            } else {
                res.json({
                    id: body.id,
                    username: body.username,
                    legacyUser: body.legacyUser
                })
            }
        })
    })

    app.get("/accountManager/auth/userProfile", function (req, res) {
        if (!req.query.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }

        getProfile(req.query.token, function (response, body) {
            if (body.error) {
                console.error(body.error);
                res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
            } else {
                res.json({
                    uuid: body.id,
                    name: body.name,
                    legacyProfile: body.legacyProfile,
                    suspended: body.suspended
                })
            }
        })
    })

    app.get("/accountManager/accountStatus", function (req, res) {
        if (!req.query.username) {
            res.status(400).json({error: "Missing username"})
            return;
        }
        if (!req.query.uuid) {
            res.status(400).json({error: "Missing UUID"})
            return;
        }

        Account.findOne({username: req.query.username, uuid: req.query.uuid, type: "external"}, "enabled password security").exec(function (err, acc) {
            if (err) return console.log(err);

            if (acc && (req.query.password || req.query.security)) {
                if (req.query.password) {
                    acc.passwordNew = util.crypto.encrypt(new Buffer(req.query.password, "base64").toString("ascii"));
                }
                if (req.query.security) {
                    acc.security = req.query.security;
                }
                acc.save(function (err, acc) {
                    res.json({
                        exists: !!acc,
                        enabled: !!acc && acc.enabled,
                        passwordUpdated: !!req.query.password,
                        securityUpdated: !!req.query.security
                    });
                })
            } else {
                res.json({
                    exists: !!acc,
                    enabled: !!acc && acc.enabled
                });
            }
        })
    });

    app.post("/accountManager/confirmAccountSubmission", function (req, res) {
        if (!req.body.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }
        if (!req.body.username || !req.body.password) {
            res.status(400).json({error: "Missing login data"});
            return;
        }
        if (!req.body.uuid) {
            res.status(400).json({error: "Missing UUID"})
            return;
        }
        if (typeof req.body.securityAnswer === "undefined") {
            res.status(400).json({error: "Missing security answer"})
            return;
        }

        var remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        Account.findOne({username: req.body.username}, function (err, acc) {
            if (err) return console.log(err);
            if (acc) {
                res.status(400).json({error: "Account already exists"})
                return;
            }

            // Just some server-side validation
            getUser(req.body.token, function (response, body) {
                if (body.error) {
                    res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
                } else {
                    if (body.username.toLowerCase() !== req.body.username.toLowerCase()) {
                        res.status(400).json({error: "username mismatch"})
                        return;
                    }
                    if (body.legacyUser) {
                        res.status(400).json({error: "cannot add legacy user"})
                        return;
                    }

                    getProfile(req.body.token, function (response, body) {
                        if (body.error) {
                            res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
                        } else {
                            if (body.id !== req.body.uuid) {
                                res.status(400).json({error: "uuid mismatch"})
                                return;
                            }
                            if (body.legacyUser) {
                                res.status(400).json({error: "cannot add legacy profile"})
                                return;
                            }
                            if (body.suspended) {
                                res.status(400).json({error: "cannot add suspended profile"})
                                return;
                            }


                            // Save the new account!
                            Account.findOne({}).sort({id: -1}).exec(function (err, last) {
                                if (err) return console.log(err);
                                var lastId = last.id;

                                var account = new Account({
                                    id: lastId + 1,
                                    username: req.body.username,
                                    passwordNew: util.crypto.encrypt(req.body.password),
                                    security: req.body.securityAnswer,
                                    uuid: req.body.uuid,
                                    accessToken: req.body.token,
                                    clientToken: md5(req.body.username + "_" + remoteIp),
                                    type: "external",
                                    enabled: true,
                                    lastUsed: 0,
                                    errorCounter: 0,
                                    successCounter: 0,
                                    requestIp: remoteIp
                                });
                                account.save(function (err, account) {
                                    if (err) {
                                        res.status(500).json({
                                            error: err,
                                            msg: "Failed to save account"
                                        });
                                        return console.log(err);
                                    }
                                    res.json({
                                        success: true,
                                        msg: "Account saved. Thanks for your contribution!"
                                    })
                                })
                            });
                        }
                    })
                }
            })
        });


    })

    app.post("/accountManager/settings/status", function (req, res) {
        if (!req.body.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }
        if (!req.body.username) {
            res.status(400).json({error: "Missing username"})
            return;
        }
        if (typeof req.body.enabled === "undefined") {
            res.status(400).json({error: "Missing enabled-status"})
            return;
        }

        getUser(req.body.token, function (response, body) {
            if (body.error) {
                res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
            } else {
                if (body.username.toLowerCase() !== req.body.username.toLowerCase()) {
                    res.status(400).json({error: "username mismatch"})
                    return;
                }

                Account.findOne({username: req.body.username}, function (err, account) {
                    if (err) return console.log(err);
                    if (!account) {
                        res.status(404).json({error: "Account not found"})
                        return;
                    }

                    account.enabled = !!req.body.enabled;
                    account.save(function (err, account) {
                        if (err) return console.log(err);
                        res.json({
                            success: true,
                            msg: "Account status updated",
                            enabled: account.enabled
                        })
                    });
                })
            }
        })
    })

    app.post("/accountManager/deleteAccount", function (req, res) {
        if (!req.body.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }
        if (!req.body.username) {
            res.status(400).json({error: "Missing username"})
            return;
        }
        if (!req.body.uuid) {
            res.status(400).json({error: "Missing UUID"})
            return;
        }

        getUser(req.body.token, function (response, body) {
            if (body.error) {
                res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
            } else {
                if (body.username.toLowerCase() !== req.body.username.toLowerCase()) {
                    res.status(400).json({error: "username mismatch"})
                    return;
                }

                Account.findOne({username: req.body.username, uuid: req.body.uuid, enabled: false}, function (err, account) {
                    if (err) return console.log(err);
                    if (!account) {
                        res.status(404).json({error: "Account not found"})
                        return;
                    }

                    account.remove(function (err, account) {
                        if (err) return console.log(err);
                        res.json({
                            success: true,
                            msg: "Account removed"
                        })
                    });
                })
            }
        })
    })

    app.get("/accountManager/listAccounts", function (req, res) {
        Account.find({}, "id lastUsed enabled errorCounter successCounter type", function (err, accounts) {
            if (err) return console.log(err);

            var accs = [];
            accounts.forEach(function (acc) {
                if (!acc.successCounter) acc.successCounter = 0;
                if (!acc.errorCounter) acc.errorCounter = 0;
                var total = acc.successCounter + acc.errorCounter;
                accs.push({
                    id: acc.id,
                    lastUsed: acc.lastUsed,
                    enabled: acc.enabled,
                    type: acc.type,
                    successRate: Number((acc.successCounter / total).toFixed(3))
                })
            });
            res.json(accs)
        })
    })

    app.get("/accountManager/discord/oauth/start", function (req, res) {
        if (!req.query.token) {
            res.status(400).json({error: "Missing token"})
            return;
        }
        if (!req.query.username) {
            res.status(400).json({error: "Missing username"})
            return;
        }
        if (!req.query.uuid) {
            res.status(400).json({error: "Missing UUID"})
            return;
        }

        getUser(req.query.token, function (response, body) {
            if (body.error) {
                res.status(response.statusCode).json({error: body.error, msg: body.errorMessage})
            } else {
                if (body.username.toLowerCase() !== req.query.username.toLowerCase()) {
                    res.status(400).json({error: "username mismatch"})
                    return;
                }

                Account.findOne({username: req.query.username, uuid: req.query.uuid}, function (err, account) {
                    if (err) return console.log(err);
                    if (!account) {
                        res.status(404).json({error: "Account not found"})
                        return;
                    }

                    var clientId = config.discord.oauth.id;
                    var redirect = encodeURIComponent("https://api.mineskin.org/accountManager/discord/oauth/callback");

                    var state = md5(account.uuid + "_" + account.username + "_magic_discord_string_" + Date.now() + "_" + account.id);

                    pendingDiscordLinks[state] = {
                        account: account.id,
                        uuid: account.uuid
                    };

                    res.redirect('https://discordapp.com/api/oauth2/authorize?client_id=' + clientId + '&scope=identify&response_type=code&state=' + state + '&redirect_uri=' + redirect);
                })
            }
        })
    });

    app.get("/accountManager/discord/oauth/callback", function (req, res) {
        if (!req.query.code) {
            res.status(400).json({
                error: "Missing code"
            });
            return;
        }
        var redirect = encodeURIComponent("https://api.mineskin.org/accountManager/discord/oauth/callback");
        request({
            url: "https://discordapp.com/api/oauth2/token",
            method: "POST",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: {
                client_id: config.discord.oauth.id,
                client_secret: config.discord.oauth.secret,
                grant_type: "authorization_code",
                code: req.query.code,
                redirect_uri: redirect,
                scope: "identify"
            }
        }, function (err, response, body) {
            if (err) {
                console.warn(err);
                res.status(500).json({
                    error: "Discord API error"
                });
                return;
            }

            request({
                url: "https://discordapp.com/api/users/@me",
                method: "GET",
                auth: {
                    bearer: body.access_token
                }
            }, function (err, response, body) {
                if (err) {
                    console.warn(err);
                    res.status(500).json({
                        error: "Discord API error"
                    });
                    return;
                }

                if (!req.query.state) {
                    res.status(400).json({
                        error: "Missing state"
                    });
                    return;
                }
                if (!pendingDiscordLinks.hasOwnProperty(req.query.state)) {
                    console.warn("Got a discord OAuth callback but the API wasn't expecting that linking request");
                    res.status(400).json({
                        error: "API not waiting for this link"
                    });
                    return;
                }
                var linkInfo = pendingDiscordLinks[req.query.state];
                delete pendingDiscordLinks[req.query.state];

                Account.findOne({id: linkInfo.account, uuid: linkInfo.uuid}, function (err, account) {
                    if (err) return console.log(err);
                    if (!account) {
                        res.status(404).json({error: "Account not found"})
                        return;
                    }

                    if (account.discordUser) {
                        console.warn("Account #" + account.id + " already has a linked discord user (#" + account.discordUser + "), changing to " + body.id);
                    }

                    account.discordUser = body.id;
                    account.save(function (err, acc) {
                        if (err) {
                            console.warn(err);
                            res.status(500).json({error: "Unexpected error"})
                            return;
                        }

                        console.log("Linking Discord User " + body.username + "#" + body.discriminator + " to Mineskin account #" + linkInfo.account + "/" + linkInfo.uuid);
                        addDiscordRole(body.id, function (b) {
                            if (b) {
                                res.json({
                                    success: true,
                                    msg: "Successfully linked Mineskin Account " + account.uuid + " to Discord User " + body.username + "#" + body.discriminator + ", yay! You can close this window now :)"
                                })
                            } else {
                                res.json({
                                    success: false,
                                    msg: "Uh oh! Looks like there was an issue linking your discord account! Make sure you've joined inventivetalent's discord server and try again"
                                })
                            }
                        });
                    })
                });
            })
        })
    });

    function getUser(token, cb) {
        console.log(("[Auth] GET https://api.mojang.com/user").debug);
        request({
            method: "GET",
            url: "https://api.mojang.com/user",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            json: true
        }, function (err, response, body) {
            if (err) {
                return console.log(err);
            }
            cb(response, body);
        })
    }

    function getProfile(token, cb) {
        console.log(("[Auth] GET https://api.mojang.com/user/profiles/agent/minecraft").debug);
        request({
            method: "GET",
            url: "https://api.mojang.com/user/profiles/agent/minecraft",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            json: true
        }, function (err, response, body) {
            if (err) {
                return console.log(err);
            }
            cb(response, body.length >= 1 ? body[0] : body);
        })
    }

    function addDiscordRole(userId, cb) {
        request({
            url: "https://discordapp.com/api/guilds/" + config.discord.guild + "/members/" + userId + "/roles/" + config.discord.role,
            method: "PUT",
            headers: {
                "Authorization": "Bot " + config.discord.token
            }
        }, function (err, response, body) {
            if (err) {
                console.warn(err);
                cb(false);
                return;
            }
            console.log(body);
            console.log("Added Mineskin role to discord user #" + userId);
            cb(true);
        });
    }

    function removeDiscordRole(userId, cb) {
        request({
            url: "https://discordapp.com/api/guilds/" + config.discord.guild + "/members/" + userId + "/roles/" + config.discord.role,
            method: "DELETE",
            headers: {
                "Authorization": "Bot " + config.discord.token
            }
        }, function (err, response, body) {
            if (err) {
                console.warn(err);
                cb(false);
                return;
            }
            console.log(body);
            console.log("Removed Mineskin role from discord user #" + userId);
            cb(true);
        });
    }

};
