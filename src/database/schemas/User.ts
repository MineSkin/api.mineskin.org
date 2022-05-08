import { model, Schema } from "mongoose";
import { IUserDocument, IUserModel } from "../../typings/db/IUserDocument";
import { Account } from "./Account";
import { getConfig } from "../../typings/Configs";

export const UserSchema: Schema<IUserDocument, IUserModel> = new Schema(
    {
        uuid: {
            type: String,
            index: true
        },
        googleId: {
            type: String,
            index: true
        },
        email: {
            type: String,
            index: true
        },
        discordId: String,
        created: Date,
        lastUsed: Date,
        sessions: Schema.Types.Mixed, // session id => creation date
        skins: [String],
        minecraftAccounts: Number
    }
)

UserSchema.statics.findForGoogleIdAndEmail = function (this: IUserModel, googleId: string, email: string): Promise<IUserDocument | null> {
    return this.findOne({
        googleId: googleId,
        email: email
    }).exec();
}

UserSchema.statics.findForIdGoogleIdAndEmail = function (this: IUserModel, uuid: string, googleId: string, email: string): Promise<IUserDocument | null> {
    return this.findOne({
        uuid: uuid,
        googleId: googleId,
        email: email
    }).exec();
}

UserSchema.statics.updateMinecraftAccounts = async function (this: IUserModel, uuid: string): Promise<void> {
    const time = Math.floor(Date.now() / 1000);
    const config = await getConfig();
    const count = await Account.countDocuments({
        user: uuid,
        enabled: true,
        $and: [
            {
                $or: [
                    { forcedTimeoutAt: { $exists: false } },
                    { forcedTimeoutAt: { $lt: (time - 500) } }
                ]
            }
        ],
        errorCounter: { $lt: (config.errorThreshold || 10) },
        timeAdded: { $lt: (time - 60) }
    }).exec();
    await this.updateOne({
        uuid: uuid
    }, {
        $set: {
            minecraftAccounts: count
        }
    }).exec();
}

export const User: IUserModel = model<IUserDocument, IUserModel>("User", UserSchema);
