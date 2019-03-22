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
    password: String,
    passwordOld: String,
    passwordNew: String,
    security: String,
    uuid: String,
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
    requestServer: String,
    type: {
        type: String,
        enum: ["internal", "external"],
        default: "internal"
    }
}, {id: false});
module.exports.Account = mongoose.model("Account", accountSchema);