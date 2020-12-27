const config = require("./config");
const {Metrics, IntervalFlusher} = require("metrics-node");
const {URL} = require("url");

const metrics = new Metrics(config.metrics);
const flusher = new IntervalFlusher(metrics, 10000);
metrics.setFlusher(flusher);

module.exports = metrics;

const REQUESTS_METRIC = metrics.metric('mineskin', 'requests');
module.exports.REQUESTS_METRIC = REQUESTS_METRIC;
module.exports.requestsMetric = function (request, response) {
    let m = REQUESTS_METRIC
        .tag("server", config.server);
    if (request) {
        let url = new URL(request.url || request.uri);
        m
            .tag("method", (request.method || "GET"))
            .tag("endpoint",  url.host + "" + url.pathname)
    }
    if (response) {
        m
            .tag("statusCode", response.statusCode)
    }
    return m;
};
