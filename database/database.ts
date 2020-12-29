import * as mongoose from "mongoose";
import { Mongoose } from "mongoose";
import { Config } from "../types/Config";
import * as tunnel from "tunnel-ssh";

export default function connectToMongo(config: Config): Promise<Mongoose> {
    return new Promise<Mongoose>((resolve, reject) => {
        if (config.mongo.useTunnel) {
            console.log("Establishing SSH Tunnel to " + config.mongo.tunnel.host + "...");
            tunnel(config.mongo.tunnel, (err, server) => {
                if (err) {
                    console.error(err);
                    return;
                }
                connectMongo(config).then(resolve).catch(reject);
            })
        } else {
            connectMongo(config).then(resolve).catch(reject);
        }
    })
};

async function connectMongo(config: Config) {
    // Connect to DB
    console.log("Connecting to mongodb://" + ((config.mongo.user || "admin") + ":*****" + "@" + (config.mongo.address || "localhost") + ":" + (config.mongo.port || 27017) + "/" + (config.mongo.database || "database")));
    const m = await mongoose.connect("mongodb://" + ((config.mongo.user || "admin") + ":" + (config.mongo.pass || "admin") + "@" + (config.mongo.address || "localhost") + ":" + (config.mongo.port || 27017) + "/" + (config.mongo.database || "database")));
    m.Promise = Promise;
    return m;
}
