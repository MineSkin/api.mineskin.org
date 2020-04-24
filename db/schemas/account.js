var mongoose = require('mongoose')
    , Schema = mongoose.Schema;
var Int32 = require("mongoose-int32");
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
    errorCounter: Int32,
    successCounter: Int32,
    lastErrorCode: String,
    forcedTimeoutAt: Number,
    lastTextureUrl: String,
    sameTextureCounter: Number,
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
