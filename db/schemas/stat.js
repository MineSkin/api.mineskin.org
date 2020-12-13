const mongoose = require('mongoose')
    , Schema = mongoose.Schema;
const trafficSchema = new Schema(
    {
        key: String,
        value: Number
    },
    {
        collection: "stats"
    });
module.exports.Stat = mongoose.model("Stat", trafficSchema);
