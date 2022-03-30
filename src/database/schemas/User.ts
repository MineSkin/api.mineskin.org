import { model, Schema } from "mongoose";
import { IUserDocument, IUserModel } from "../../typings/db/IUserDocument";

export const schema: Schema<IUserDocument, IUserModel> = new Schema(
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
        created: {
            type: Date
        },
        lastUsed: {
            type: Date
        },
        sessions: [{
            token: String,
            date: Date
        }],
        minecraftAccounts: [String]
    }
)

schema.statics.findForGoogleIdAndEmail = function(this: IUserModel, googleId: string, email: string): Promise<IUserDocument | null> {
    return this.findOne({
        googleId: googleId,
        email: email
    }).exec();
}

export const User: IUserModel = model<IUserDocument, IUserModel>("User", schema);
