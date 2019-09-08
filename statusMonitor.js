var auth = require("http-auth");

module.exports = function (app, config) {
    var basic = auth.basic({realm: "Monitor Area"}, function (user, pass, callback) {
        callback(user === config.monitor.auth.user && pass === config.monitor.auth.pass);
    });

    var statusMonitor = require("express-status-monitor")({
        path: ''
    });
    app.use(statusMonitor.middleware);
    app.get("/status-monitor", auth.connect(basic), statusMonitor.pageRoute);
};
