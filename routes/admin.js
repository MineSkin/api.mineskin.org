module.exports = function (app) {

    // Schemas
    const Account = require("../database/schemas/Account").IAccount;
    const Skin = require("../database/schemas/Skin").ISkin;
    const Traffic = require("../database/schemas/Traffic").ITraffic;


    // app.get("/admin/accounts",function (req,res) {
    //     Account.find({},function (err,accounts) {
    //         if(err)return console.log(err);
    //         console.log(accounts);
    //         res.render("admin/accounts",{
    //             accounts:accounts
    //         });
    //     })
    // })

}
