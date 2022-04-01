import { model, Schema } from "mongoose";
import { IUserDocument, IUserModel } from "../../typings/db/IUserDocument";

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
        created: {
            type: Date
        },
        lastUsed: {
            type: Date
        },
        sessions: Schema.Types.Mixed, // session id => creation date
        skins: [String]
    }
)

UserSchema.statics.findForGoogleIdAndEmail = function(this: IUserModel, googleId: string, email: string): Promise<IUserDocument | null> {
    return this.findOne({
        googleId: googleId,
        email: email
    }).exec();
}

UserSchema.statics.findForIdGoogleIdAndEmail = function(this: IUserModel, uuid: string, googleId: string, email: string): Promise<IUserDocument | null> {
    return this.findOne({
        uuid: uuid,
        googleId: googleId,
        email: email
    }).exec();
}

export const User: IUserModel = model<IUserDocument, IUserModel>("User", UserSchema);
