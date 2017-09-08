var request = require("request");

module.exports = {};

module.exports.getSkinData = function (account, cb) {
    console.log(("[DataFetcher] Loading Skin data for " + (account.id ? "account #" + account.id : account.uuid)).info);
    console.log(account.uuid.debug)
    request("https://sessionserver.mojang.com/session/minecraft/profile/" + account.uuid + "?unsigned=false", function (err, response, body) {
        if (err) {
            console.log(err);
            return cb(err, null);
        }
        console.log(response.statusCode.toString().debug);
        console.log(body.debug)
        if (response.statusCode !== 200) {
            return cb(response.statusCode, null);
        }
        if(!body) {
            cb(null, null);
        }
        var json = JSON.parse(body);
        cb(null, {
            value: json.properties[0].value,
            signature: json.properties[0].signature,
            raw: json
        });
    })
};