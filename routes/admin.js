module.exports = function (app) {

    // Schemas
    const Account = require("../database/schemas/account").Account;
    const Skin = require("../database/schemas/skin").Skin;
    const Traffic = require("../database/schemas/traffic").Traffic;


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
