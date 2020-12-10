var config = {};

config.port = 3017;
config.server = "default";

config.generateDelay = 60;
config.errorThreshold = 10;

config.genSaveDelay = 5;

config.optimus = {
    prime: 0,
    inverse: 0,
    random: 0
};

config.mongo = {
    useTunnel: false,
    tunnel: {
        username: "mongo",
        host: "1.2.3.4",
        privateKey: require("fs").readFileSync("./id_rsa"),
        port: 22,
        dstPort: 27017
    },
    user: "admin",
    pass: "admin",
    address: "localhost",
    port: 27017,
    database: "mineskin"
};

config.crypto = {
    algorithm:"aes-256-ctr",
    key: "I'm a key!"
};

config.discord = {
    token: "",
    channel: ""
};

config.microsoft = {
    clientId: "",
    clientSecret: ""
};

config.puller = {
    endpoint: "/_git_webhook",
    secret: "",
    vars: {
        appName: "MineSkin"
    },
    logCommands: true
};

module.exports = config;
