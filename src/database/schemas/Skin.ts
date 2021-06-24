import { model, Schema } from "mongoose";
import { modelToVariant, stripUuid } from "../../util";
import { ISkinDocument } from "../../typings";
import { ISkinModel, SkinVisibility } from "../../typings/db/ISkinDocument";
import { SkinInfo } from "../../typings/SkinInfo";
import { v4 as randomUuid } from "uuid";
import { Generator, HASH_VERSION } from "../../generator/Generator";

export const SkinSchema: Schema<ISkinDocument, ISkinModel> = new Schema({
    id: {
        type: Number,
        index: true,
        unique: true
    },
    skinUuid: {
        type: String,
        index: true,
        //TODO: unique + replace nulls
    },
    hash: {
        type: String,
        index: true
    },
    name: {
        type: String,
        index: 'text'
    },
    uuid: {
        type: String
    },
    model: {
        type: String,
        enum: ["steve", "slim", "unknown"],
        index: true
    },
    variant: {
        type: String,
        enum: ["classic", "slim", "unknown"]
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
    minecraftTextureHash: {
        type: String,
        index: true
    },
    skinId: String,
    skinTextureId: String,
    minecraftSkinId: String,
    textureHash: String,
    capeUrl: {
        type: String
    },
    time: {
        type: Number,
        index: true
    },
    generateDuration: Number,
    account: Number,
    breadcrumb: String,
    type: String,
    duplicate: {
        type: Number,
        index: true
    },
    views: {
        type: Number,
        index: true
    },
    via: String,
    server: String,
    ua: String,
    apiKey: String,
    apiVer: String,
    testerRequest: Boolean,
    testerMismatchCounter: Number,
    hv: Number
}, { id: false })

/// METHODS

SkinSchema.methods.getUuid = function (this: ISkinDocument): string {
    if (this.skinUuid) {
        return this.skinUuid;
    }
    this.skinUuid = stripUuid(randomUuid());
    return this.skinUuid;
}

//TODO: remove, temporary thing to convert hash versions
SkinSchema.methods.getHash = async function (this: ISkinDocument): Promise<string> {
    if (this.hv === HASH_VERSION) {
        return this.hash;
    }
    const oldHash = this.hash;
    const newHash = await Generator.getMojangHash(this.url).then(info => info.hash);
    if (newHash) {
        this.hash = newHash;
        this.hv = HASH_VERSION;
        console.log("Converted hash of " + this.getUuid() + " to new version (" + oldHash + "->" + this.hash + ")");
    }
    return this.hash;
}

SkinSchema.methods.toResponseJson = async function (this: ISkinDocument): Promise<SkinInfo> {
    return {
        id: this.id,
        idStr: "" + this.id,
        uuid: this.getUuid(),
        hash: await this.getHash(),
        name: this.name || "",
        model: this.model,
        variant: modelToVariant(this.model),
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
        account: this.account || 0,
        server: this.server || "unknown",
        private: this.visibility == SkinVisibility.PRIVATE,
        views: this.views
    };
};

/// STATICS

SkinSchema.statics.findForId = function ( id: number): Promise<ISkinDocument | null> {
    return Skin.findOne({ id: id }).exec();
};

SkinSchema.statics.findForUuid = function ( uuid: string): Promise<ISkinDocument | null> {
    return Skin.findOne({ skinUuid: uuid }).exec();
};

SkinSchema.statics.attachTesterResult = function ( id: number, server: string, mismatchCount: number): Promise<ISkinDocument | null> {
    return Skin.findOneAndUpdate({ id: id, server: server }, { testerRequest: true, testerMismatchCounter: mismatchCount }).exec();
};

export const Skin: ISkinModel = model<ISkinDocument, ISkinModel>("Skin", SkinSchema);
