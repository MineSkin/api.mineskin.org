import mongoose, { ConnectOptions, Mongoose } from "mongoose";
import * as Sentry from "@sentry/node";
import { MineSkinConfig } from "../typings/Configs";
import tunnel = require("tunnel-ssh");

export function connectToMongo(config: MineSkinConfig): Promise<Mongoose> {
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
}

async function connectMongo(config: MineSkinConfig) {
    // Connect to DB

    const options: ConnectOptions = {
        autoIndex: false
    };

    let m: Mongoose;
    if (config.mongo.url) {
        console.log("Connecting to mongodb...");
        m = await mongoose.connect(config.mongo.url, options);
    } else {
        console.log("Connecting to mongodb://" + ((config.mongo.user || "admin") + ":*****" + "@" + (config.mongo.address || "localhost") + ":" + (config.mongo.port || 27017) + "/" + (config.mongo.database || "database")));
        m = await mongoose.connect("mongodb://" + ((config.mongo.user || "admin") + ":" + (config.mongo.pass || "admin") + "@" + (config.mongo.address || "localhost") + ":" + (config.mongo.port || 27017) + "/" + (config.mongo.database || "database")), options);
    }
    console.info("MongoDB connected!");

    mongoose.connection.on("error", err => {
        Sentry.captureException(err);
        console.warn("Mongo connection error, restarting app");
        setTimeout(() => {
            process.exit(1);
        }, 10000);
    })

    return m;
}
