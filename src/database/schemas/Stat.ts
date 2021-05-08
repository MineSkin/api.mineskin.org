import { Model, model, Schema } from "mongoose";
import { Maybe } from "../../util";
import { IStatDocument, IStatModel } from "../../typings/db/IStatDocument";

const schema: Schema<IStatDocument, IStatModel> = new Schema(
    {
        key: String,
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

export const Stat: IStatModel = model<IStatDocument, IStatModel>("Stat", schema);
