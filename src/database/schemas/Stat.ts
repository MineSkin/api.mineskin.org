import { model, Schema } from "mongoose";
import { Maybe } from "../../util";
import { IStatDocument, IStatModel } from "../../typings/db/IStatDocument";

const schema: Schema<IStatDocument, IStatModel> = new Schema(
    {
        key: {
            type: String,
            index: true
        },
        value: Number
    },
    {
        collection: "stats"
    });

schema.statics.inc = function (this: IStatModel, key: string, amount = 1): Promise<Maybe<IStatDocument>> {
    return this.findOne({ key: key }).exec().then((stat: IStatDocument) => {
        if (!stat) {
            console.warn("Invalid stat key " + key);
            return undefined;
        }
        stat.value += amount;
        return stat.save();
    });
};

schema.statics.get = function (this: IStatModel, key: string): Promise<Maybe<number>> {
    return this.findOne({ key: key }).exec().then((stat: IStatDocument) => {
        if (!stat) {
            console.warn("Invalid stat key " + key);
            return undefined;
        }
        return stat.value;
    });
}

schema.statics.set = function (this: IStatModel, key: string, value: number): Promise<void> {
    return this.updateOne({ key: key }, { $set: { value: value } }, { upsert: true }).exec().then(res => {
    });
}

export const Stat: IStatModel = model<IStatDocument, IStatModel>("Stat", schema);
