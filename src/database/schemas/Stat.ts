import { model, Schema } from "mongoose";
import { Maybe } from "../../util";
import { IStatDocument, IStatModel } from "../../typings/db/IStatDocument";

const schema: Schema<IStatDocument, IStatModel> = new Schema(
    {
        key: {
            type: String,
            index: true
        },
        value: Number,
        expire: Date
    },
    {
        collection: "stats"
    });

schema.statics.inc = async function (this: IStatModel, key: string, amount = 1): Promise<Maybe<IStatDocument>> {
    //TODO
    let stat = await this.findOne({key: key}).exec();
    if (!stat) {
        stat = new Stat();
        stat.key = key;
    }
    stat.value += amount;
    return stat.save();
};

schema.statics.incWithExpiration = async function (this: IStatModel, key: string, expire: Date, amount = 1): Promise<Maybe<IStatDocument>> {
    //TODO
    let stat = await this.findOne({key: key}).exec();
    if (!stat) {
        stat = new Stat();
        stat.key = key;
        stat.value = 0;
    }
    stat.expire = expire;
    stat.value += amount;
    return stat.save();
};

schema.statics.get = async function (this: IStatModel, key: string): Promise<Maybe<number>> {
    const stat = await this.findOne({key: key}).exec();
    if (!stat) {
        console.warn("Invalid stat key " + key);
        return undefined;
    }
    return stat.value;
}

schema.statics.set = async function (this: IStatModel, key: string, value: number): Promise<void> {
    const res = await this.updateOne({key: key}, {$set: {value: value}}, {upsert: true}).exec();
}

schema.statics.setWithExpiration = async function (this: IStatModel, key: string, value: number, expire: Date): Promise<void> {
    const res = await this.updateOne({key: key}, {$set: {value: value, expire: expire}}, {upsert: true}).exec();
}

export const Stat: IStatModel = model<IStatDocument, IStatModel>("Stat", schema);
