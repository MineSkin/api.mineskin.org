var config = {};

config.port = 3017;

config.mongo = {
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

module.exports = config;