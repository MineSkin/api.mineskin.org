module.exports = function (mongoose, config) {

    if (config.mongo.useTunnel) {
        console.log("Establishing SSH Tunnel to " + config.mongo.tunnel.host + "...");
        require("tunnel-ssh")(config.mongo.tunnel, function (err, server) {
            if (err) {
                console.error(err);
                return;
            }
            connectMongo(mongoose, config);
        })
    } else {
        connectMongo(mongoose, config);
    }


};

function connectMongo(mongoose, config) {
    // Connect to DB
    console.log("Connecting to mongodb://" + ((config.mongo.user || "admin") + ":*****" + "@" + (config.mongo.address || "localhost") + ":" + (config.mongo.port || 27017) + "/" + (config.mongo.database || "database")));
    mongoose.connect("mongodb://" + ((config.mongo.user || "admin") + ":" + (config.mongo.pass || "admin") + "@" + (config.mongo.address || "localhost") + ":" + (config.mongo.port || 27017) + "/" + (config.mongo.database || "database")));

    mongoose.Promise = Promise;
}