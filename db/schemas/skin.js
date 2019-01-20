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
        enum: ["steve", "slim", "unknown"],
        index: true
    },
    visibility: {
        type: Number,
        index: true
    },
    value: String,
    signature: String,
    url: {
        type: String,
        index: true
    },
    capeUrl: String,
    time: Number,
    generateDuration: Number,
    account: Number,
    type: String,
    duplicate: Number,
    views: Number,
    via: String,
    ua: String,
    apiVer: String
}, {id: false})
module.exports.Skin = mongoose.model("Skin", skinSchema);