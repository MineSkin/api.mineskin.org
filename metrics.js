const config = require("./config");
const {Metrics, IntervalFlusher} = require("inventive-metrics-node");

const metrics = new Metrics(config.metrics);
const flusher = new IntervalFlusher(metrics, 10000);
metrics.setFlusher(flusher);

module.exports = metrics;
