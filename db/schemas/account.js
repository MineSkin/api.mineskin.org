var mongoose = require('mongoose')
    , Schema = mongoose.Schema;
var accountSchema = new Schema({
    id: {
        type: Number,
        index: true
    },
    username: {
        type: String,
        index: true
    },
    playername: String,
    authInterceptorEnabled: Boolean,
    password: String,
    passwordOld: String,
    passwordNew: String,
    security: String,
    uuid: String,
    lastSelected: Number,
    lastUsed: {
        type: Number,
        index: true
    },
    enabled: {
        type: Boolean,
        index: true
    },
    errorCounter: Number,
    successCounter: Number,
    accessToken: String,
    clientToken: String,
    requestIp: String,
    requestServer: {
        type: String,
        index: true
    },
    type: {
        type: String,
        enum: ["internal", "external"],
        default: "internal"
    },
    discordUser: String
}, {id: false});
module.exports.Account = mongoose.model("Account", accountSchema);
