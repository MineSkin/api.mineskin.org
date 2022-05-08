import { Document, Model } from "mongoose";
import { Maybe } from "../../util";


export interface IUserDocument extends Document {
    uuid: string;
    googleId: string;
    email: string;
    discordId?: string;
    created: Date;
    lastUsed: Date;
    sessions: {[token: string]: Date};
    skins: string[];
    minecraftAccounts: number;
}

export interface IUserModel extends Model<IUserDocument> {
    findForGoogleIdAndEmail(googleId: string, email: string): Promise<Maybe<IUserDocument>>;
    findForIdGoogleIdAndEmail(uuid: string, googleId: string, email: string): Promise<Maybe<IUserDocument>>;

    updateMinecraftAccounts(uuid: string): Promise<void>;
}
