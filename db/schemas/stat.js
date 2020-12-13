const mongoose = require('mongoose')
    , Schema = mongoose.Schema;
var trafficSchema = new Schema(
    {
        key: String,
        value: Number
    },
    {
        collection: "stats"
    });
module.exports.Stat = mongoose.model("Stat", trafficSchema);
