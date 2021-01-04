import { model, Schema } from "mongoose";
import { ISkinDocument } from "../../types";
import { ISkinModel, SkinModel, SkinVisibility } from "../../types/ISkinDocument";
import { SkinInfo } from "../../types/SkinInfo";

export const SkinSchema: Schema = new Schema({
    id: {
        type: Number,
        index: true,
        unique: true
    },
    hash: {
        type: String,
        index: true
    },
    name: {
        type: String,
        index: true
    },
    uuid: {
        type: String,
        index: true
    },
    model: {
        type: String,
        enum: ["steve", "slim", "unknown"],
        index: true
    },
    visibility: {
        type: Number,
        index: true
    },
    value: String,
    signature: String,
    url: {
        type: String,
        index: true
    },
    skinId: String,
    skinTextureId: String,
    textureHash: String,
    capeUrl: {
        type: String,
        index: true
    },
    time: {
        type: Number,
        index: true
    },
    generateDuration: Number,
    account: Number,
    type: String,
    duplicate: Number,
    views: Number,
    via: String,
    server: String,
    ua: String,
    apiVer: String,
    testerRequest: Boolean,
    testerMismatchCounter: Number
}, { id: false })

/// METHODS

SkinSchema.methods.toResponseJson = function (this: ISkinDocument, delay?: number): SkinInfo {
    const info: SkinInfo = {
        id: this.id,
        idStr: "" + this.id,
        name: this.name,
        model: this.model,
        data: {
            uuid: this.uuid,
            texture: {
                value: this.value,
                signature: this.signature,
                url: this.url,
                urls: {
                    skin: this.url,
                    cape: this.capeUrl
                }
            }
        },
        timestamp: Math.round(this.time) || 0,
        duration: this.generateDuration || 0,
        accountId: this.account || 0,
        server: this.server || "unknown",
        private: this.visibility == SkinVisibility.PRIVATE,
        views: this.views
    };
    if (delay) {
        info.nextRequest = delay;
    }
    return info;
};

/// STATICS

SkinSchema.statics.findForId = function (this: ISkinModel, id: number): Promise<ISkinDocument> {
    return this.findOne({ id: id }).exec();
};

SkinSchema.statics.findExistingForHash = function (this: ISkinModel, hash: string, name: string, model: SkinModel, visibility: SkinVisibility): Promise<ISkinDocument> {
    return this.findOne({ hash: hash, name: name, model: model, visibility: visibility }).exec()
        .then((skin: ISkinDocument) => {
            if (skin) {
                console.log("Found existing skin with same hash");
                skin.duplicate += 1;
                return skin.save();
            }
            return skin;
        });
};
SkinSchema.statics.findExistingForTextureUrl = function (this: ISkinModel, url: string, name: string, model: SkinModel, visibility: SkinVisibility): Promise<ISkinDocument> {
    return this.findOne({ url: url, name: name, model: model, visibility: visibility }).exec()
        .then((skin: ISkinDocument) => {
            if (skin) {
                console.log("Found existing skin with same texture url");
                skin.duplicate += 1;
                return skin.save();
            }
            return skin;
        });
};

SkinSchema.statics.attachTesterResult = function (this: ISkinModel, id: number, server: string, mismatchCount: number): Promise<ISkinDocument> {
    return this.findOneAndUpdate({ id: id, server: server }, { testerRequest: true, testerMismatchCounter: mismatchCount });
};

export const Skin: ISkinModel = model<ISkinDocument, ISkinModel>("Skin", SkinSchema);
