module.exports = function (app) {

    // Schemas
    const Account = require("../db/schemas/account").Account;
    const Skin = require("../db/schemas/skin").Skin;
    const Traffic = require("../db/schemas/traffic").Traffic;


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
