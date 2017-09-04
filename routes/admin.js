module.exports = function (app) {

    // Schemas
    var Account = require("../db/schemas/account").Account;
    var Skin = require("../db/schemas/skin").Skin;
    var Traffic = require("../db/schemas/traffic").Traffic;


    app.get("/admin/accounts",function (req,res) {
        Account.find({},function (err,accounts) {
            if(err)return console.log(err);
            console.log(accounts);
            res.render("admin/accounts",{
                accounts:accounts
            });
        })
    })
    
}