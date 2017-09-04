var mongoose = require('mongoose')
    , Schema = mongoose.Schema;
var trafficSchema = new Schema(
    {
        ip: String,
        lastRequest: Number
    },
    {
        collection: "traffic"
    })
module.exports.Traffic = mongoose.model("Traffic", trafficSchema);