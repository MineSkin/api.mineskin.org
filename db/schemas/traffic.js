const mongoose = require('mongoose')
    , Schema = mongoose.Schema;
const trafficSchema = new Schema(
    {
        ip: String,
        lastRequest: {
            type: Date,
            expires: 3600
        }
    },
    {
        collection: "traffic"
    })
module.exports.Traffic = mongoose.model("Traffic", trafficSchema);
