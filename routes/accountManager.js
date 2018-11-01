module.exports = function (app) {

    var util = require("../util");
    var urls = require("../generator/urls");
    var request = require("request");

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

        request({
            method: "POST",
            url: urls.authenticate,
            headers: {
                "Content-Type": "application/json"
            },
            json: true,
            body: {
                username: req.body.username,
                password: req.body.password
            }
        }, function (err, response, body) {
            console.log("Refresh Body:".debug)
            console.log(("" + JSON.stringify(body)).debug);
            if (err) {
                return console.log(err);
            }
            if (body.error) {
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

        request({
            url: urls.security.location,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + req.body.token
            }
        }, function (err, response, body) {
            if (err) return console.log(err);

            if (!response || response.statusCode !== 200) {// Not yet answered
                // Get the questions
                request({
                    url: urls.security.challenges,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + req.body.token
                    }
                }, function (err, response, body) {
                    if (err) return console.log(err);

                    var questions = JSON.parse(body);
                    var answers = [];
                    if(questions) {
                        questions.forEach(function (question) {
                            answers.push({id: question.answer.id, answer: req.body.securityAnswer});
                        });
                    }

                    // Post answers
                    request({
                        method: "POST",
                        url: urls.security.location,
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": "Bearer " + req.body.token
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

        Account.findOne({username: req.query.username, uuid: req.query.uuid, type: "external"}, "enabled").lean().exec(function (err, acc) {
            if (err) return console.log(err);
            res.json({
                exists: !!acc,
                enabled: !!acc && acc.enabled
            });
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
                                    clientToken: "",
                                    type: "external",
                                    enabled: true,
                                    lastUsed: 0,
                                    errorCounter: 0,
                                    requestIp: ""
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

    function getUser(token, cb) {
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

};