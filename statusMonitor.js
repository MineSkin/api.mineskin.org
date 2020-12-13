const auth = require("http-auth");

module.exports = function (app, config) {
    const basic = auth.basic({realm: "Monitor Area"}, function (user, pass, callback) {
        callback(user === config.monitor.auth.user && pass === config.monitor.auth.pass);
    });

    const statusMonitor = require("express-status-monitor")({
        path: '',
        title: 'Mineskin Status'
    });
    app.use(statusMonitor.middleware);
    app.get("/status-monitor", auth.connect(basic), statusMonitor.pageRoute);
};
