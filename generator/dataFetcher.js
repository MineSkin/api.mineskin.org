var request = require("request");

module.exports = {};

var cache = {};
module.exports.cache = cache;

setInterval(function () {
    for (var id in cache) {
        if ((Date.now() / 1000) - cache[id].time > (cache[id].notFound ? 240 : 90)) {
            delete cache[id];
        }
    }
}, 30000);

// TODO: could update this to use https://api.minecraftservices.com/minecraft/profile
module.exports.getSkinData = function (account, cb) {
    console.log(("[DataFetcher] Loading Skin data for " + (account.id ? "account #" + account.id + " (" + account.uuid + ")" : account.uuid)).info);
    console.log(account.uuid.debug)
    setTimeout(function () {
        if (cache.hasOwnProperty(account.uuid)) {
            console.warn("DATA FETCHER CACHE HIT! Current Size: " + Object.keys(cache).length);
            var ca = cache[account.uuid];
            if(ca.notFound){
                console.warn("Requested " + account.uuid + ", cached as NotFound " + ((Date.now() / 1000) - ca.time) + "s ago")
                cb(null, null);
            }else {
                console.warn("Requested " + account.uuid + ", cached " + ((Date.now() / 1000) - ca.time) + "s ago")
                cb(null, ca);
            }
        } else {
            request("https://sessionserver.mojang.com/session/minecraft/profile/" + account.uuid + "?unsigned=false", function (err, response, body) {
                if (err) {
                    console.log(err);
                    return cb(err, null);
                }
                console.log(response.statusCode.toString().debug);
                console.log(body.debug)
                if (response.statusCode < 200 || response.statusCode > 230) {
                    return cb(response.statusCode, null);
                }
                if (!body) {
                    cb(null, null);
                    cache[account.uuid] = {
                        notFound: true,
                        time: Date.now() / 1000
                    };
                    return;
                }
                var json = JSON.parse(body);
                var data = {
                    value: json.properties[0].value,
                    signature: json.properties[0].signature,
                    raw: json,
                    time: Date.now() / 1000
                };
                // if (!account.id) {// should be a user request
                cache[account.uuid] = data;
                // }
                cb(null, data);
            });
        }
    }, 200);
};
