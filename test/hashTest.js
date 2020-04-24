var hasha = require("hasha");

var imageHash = function (path, callback) {
    hasha.fromFile(path, {
        algorithm: "sha1"
    }).then(function (value) {
        callback(null, value);
    }).catch(function (reason) {
        callback(reason, null);
    })
};

imageHash("./images/a.png",function (err,hash) {
    console.log("a: " + hash);
});
imageHash("./images/b.png",function (err,hash) {
    console.log("b: " + hash);
});
imageHash("./images/c.png",function (err,hash) {
    console.log("c: " + hash);
});
imageHash("./images/d.png",function (err,hash) {
    console.log("d: " + hash);
});
imageHash("./images/e.png",function (err,hash) {
    console.log("e: " + hash);
});
imageHash("./images/f.png",function (err,hash) {
    console.log("f: " + hash);
});
