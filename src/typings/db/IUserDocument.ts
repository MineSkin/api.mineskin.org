import { Model } from "mongoose";
import { Maybe } from "../../util";

export interface IUserDocument extends Document {
    uuid: string;
    googleId: string;
    email: string;
    created: Date;
    lastUsed: Date;
    sessions: [{
        token: string;
        date: Date;
    }];
    minecraftAccounts: string[];
}

export interface IUserModel extends Model<IUserDocument> {
    findForGoogleIdAndEmail(googleId: string, email: string): Promise<Maybe<IUserDocument>>;
}
