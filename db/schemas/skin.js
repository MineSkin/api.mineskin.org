var mongoose = require('mongoose')
    , Schema = mongoose.Schema;
var skinSchema = new Schema({
    id: {
        type: Number,
        index: true
    },
    hash: {
        type: String,
        index: true
    },
    name: {
        type: String,
        index: true
    },
    uuid: {
        type: String,
        index: true
    },
    model: {
        type: String,
        enum: ["steve", "slim", "unknown"]
    },
    visibility: Number,
    value: String,
    signature: String,
    url: String,
    time: Number,
    generateDuration: Number,
    account: Number,
    type: String,
    duplicate: Number,
    views: Number,
    via: String,
    apiVer: String
}, {id: false})
module.exports.Skin = mongoose.model("Skin", skinSchema);