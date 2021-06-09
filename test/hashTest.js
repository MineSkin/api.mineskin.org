const crypto =  require("crypto");

const {imageHash} = require("@inventivetalent/image-hash");

const hasha = require("hasha");

const imgHash = function (path, callback) {
    imageHash(path, 64, true, (err, data) => callback(err, data));
};

 function sha1(str){
    return crypto.createHash('sha1').update(str).digest("hex");
}

imgHash("./images/e67f768c98ccd2dca2fb6f0c9a676138.png", function (err,hash) {
    console.log("1 e67f768c98ccd2dca2fb6f0c9a676138: " + hash);
})
imgHash("./images/2e1409adf419f9807f97b78a3440fe877eba5f2d77f194c97f9f579d84952104.png", function (err,hash) {
    console.log("1 2e1409adf419f9807f97b78a3440fe877eba5f2d77f194c97f9f579d84952104: " + hash);
})
imgHash("./images/a.png",function (err,hash) {
    console.log("1 a: " + hash);
});
imgHash("./images/a1.png",function (err,hash) {
    console.log("1 a1: " + hash);
});
imgHash("./images/a2.png",function (err,hash) {
    console.log("1 a2: " + hash);
});
imgHash("./images/a3.png",function (err,hash) {
    console.log("1 a3: " + hash);
});
imgHash("./images/b.png",function (err,hash) {
    console.log("1 b: " + hash);
});
imgHash("./images/c.png",function (err,hash) {
    console.log("1 c: " + hash);
});
imgHash("./images/d.png",function (err,hash) {
    console.log("1 d: " + hash);
});
imgHash("./images/e.png",function (err,hash) {
    console.log("1 e: " + hash);
});
imgHash("./images/f.png",function (err,hash) {
    console.log("1 f: " + hash);
});
imgHash("./images/f2.png",function (err,hash) {
    console.log("1 f2: " + hash);
});
imgHash("./images/fi.png",function (err,hash) {
    console.log("1 fi: " + hash);
});
imgHash("./images/g.png",function (err,hash) {
    console.log("1 g: " + hash);
});
imgHash("./images/UbMwWCF.png",function (err,hash) {
    console.log("1 UbMwWCF: " + hash);
});
imgHash("./images/33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216.png",function (err,hash) {
    console.log("1 33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216: " + hash);
});
imgHash("./images/80381669-90487000-88a1-11ea-815a-226d0641a41f.png",function (err,hash) {
    console.log("1 80381669-90487000-88a1-11ea-815a-226d0641a41f: " + hash);
});
imgHash("./images/1ecb26656ac2e9a025ad3813a3348bc947a451b9ca3622bd6397da7e9c07eb56.png",function (err,hash) {
    console.log("1 1ecb26656ac2e9a025ad3813a3348bc947a451b9ca3622bd6397da7e9c07eb56: " + hash);
});

imgHash("./images/x.png",function (err,hash) {
    console.log("1 x: " + hash);
});
imgHash("./images/y.png",function (err,hash) {
    console.log("1 y: " + hash);
});

imgHash("./images2/a.png",function (err,hash) {
    console.log("2 a: " + hash);
});
imgHash("./images2/b.png",function (err,hash) {
    console.log("2 b: " + hash);
});
imgHash("./images2/c.png",function (err,hash) {
    console.log("2 c: " + hash);
});
imgHash("./images2/d.png",function (err,hash) {
    console.log("2 d: " + hash);
});
imgHash("./images2/e.png",function (err,hash) {
    console.log("2 e: " + hash);
});
imgHash("./images2/f.png",function (err,hash) {
    console.log("2 f: " + hash);
});
imgHash("./images2/g.png",function (err,hash) {
    console.log("2 g: " + hash);
});
imgHash("./images2/UbMwWCF.png",function (err,hash) {
    console.log("2 UbMwWCF: " + hash);
});
imgHash("./images2/33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216.png",function (err,hash) {
    console.log("2 33f0306e3488b95a8e29307171b273567de87a651dd1ac6adeb4d6cc67bcf216: " + hash);
});
imgHash("./images2/dafqweqghtue.png",function (err,hash) {
    console.log("2 dafqweqghtue: " + hash);
});
imgHash("./images2/6f81077323a41b569adf22b1b3405f58e46790b4248b762876d7abea6b41d7fb.png",function (err,hash) {
    console.log("2 6f81077323a41b569adf22b1b3405f58e46790b4248b762876d7abea6b41d7fb: " + hash);
});

