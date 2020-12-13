const hasha = require("hasha");

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
    console.log("1 a: " + hash);
});
imageHash("./images/b.png",function (err,hash) {
    console.log("1 b: " + hash);
});
imageHash("./images/c.png",function (err,hash) {
    console.log("1 c: " + hash);
});
imageHash("./images/d.png",function (err,hash) {
    console.log("1 d: " + hash);
});
imageHash("./images/e.png",function (err,hash) {
    console.log("1 e: " + hash);
});
imageHash("./images/f.png",function (err,hash) {
    console.log("1 f: " + hash);
});
imageHash("./images/g.png",function (err,hash) {
    console.log("1 g: " + hash);
});
imageHash("./images/UbMwWCF.png",function (err,hash) {
    console.log("1 UbMwWCF: " + hash);
});
imageHash("./images/33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216.png",function (err,hash) {
    console.log("1 33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216: " + hash);
});
imageHash("./images/80381669-90487000-88a1-11ea-815a-226d0641a41f.png",function (err,hash) {
    console.log("1 80381669-90487000-88a1-11ea-815a-226d0641a41f: " + hash);
});
imageHash("./images/1ecb26656ac2e9a025ad3813a3348bc947a451b9ca3622bd6397da7e9c07eb56.png",function (err,hash) {
    console.log("1 1ecb26656ac2e9a025ad3813a3348bc947a451b9ca3622bd6397da7e9c07eb56: " + hash);
});

imageHash("./images/x.png",function (err,hash) {
    console.log("1 x: " + hash);
});
imageHash("./images/y.png",function (err,hash) {
    console.log("1 y: " + hash);
});

imageHash("./images2/a.png",function (err,hash) {
    console.log("2 a: " + hash);
});
imageHash("./images2/b.png",function (err,hash) {
    console.log("2 b: " + hash);
});
imageHash("./images2/c.png",function (err,hash) {
    console.log("2 c: " + hash);
});
imageHash("./images2/d.png",function (err,hash) {
    console.log("2 d: " + hash);
});
imageHash("./images2/e.png",function (err,hash) {
    console.log("2 e: " + hash);
});
imageHash("./images2/f.png",function (err,hash) {
    console.log("2 f: " + hash);
});
imageHash("./images2/g.png",function (err,hash) {
    console.log("2 g: " + hash);
});
imageHash("./images2/UbMwWCF.png",function (err,hash) {
    console.log("2 UbMwWCF: " + hash);
});
imageHash("./images2/33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216.png",function (err,hash) {
    console.log("2 33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216: " + hash);
});
imageHash("./images2/dafqweqghtue.png",function (err,hash) {
    console.log("2 dafqweqghtue: " + hash);
});
imageHash("./images2/6f81077323a41b569adf22b1b3405f58e46790b4248b762876d7abea6b41d7fb.png",function (err,hash) {
    console.log("2 6f81077323a41b569adf22b1b3405f58e46790b4248b762876d7abea6b41d7fb: " + hash);
});

