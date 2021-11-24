import * as fs from "fs";
import * as tmp from "tmp";
import { DirOptions, FileOptions } from "tmp";
import { Stream } from "stream";
import { Requests } from "./Requests";
import { UploadedFile } from "express-fileupload";

export const URL_DIR = "/tmp/url";
export const UPL_DIR = "/tmp/upl";
export const USR_DIR = "/tmp/usr";
export const MOJ_DIR = "/tmp/moj";

export class TempDir {
    constructor(public readonly path: string, private readonly removeCallback: () => void) {
    }

    remove(): void {
        this.removeCallback();
    }
}

export class TempFile extends TempDir {
    constructor(public readonly path: string, public readonly fd: number, removeCallback: () => void) {
        super(path, removeCallback);
    }

    remove() {
        super.remove();
        fs.close(this.fd, () => {
        });
    }
}

// Cleanup temp stuff on process exit
tmp.setGracefulCleanup();

export class Temp {

    static async file(options?: FileOptions): Promise<TempFile> {
        return new Promise((resolve, reject) => {
            tmp.file(options || {}, (err, name, fd, removeCallback) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(new TempFile(name, fd, removeCallback));
                }
            })
        });
    }

    static async dir(options?: DirOptions): Promise<TempDir> {
        return new Promise((resolve, reject) => {
            tmp.dir(options || {}, (err, name, removeCallback) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(new TempDir(name, removeCallback));
                }
            })
        });
    }

    // UTIL

    public static async downloadImage(url: string, tmpFile?: TempFile, breadcrumb?: string): Promise<TempFile> {
        if (!tmpFile) {
            tmpFile = await this.file();
        }
        try {
            const response = await Requests.genericRequest({
                method: "GET",
                url: url,
                responseType: "stream"
            }, breadcrumb);
            (response.data as Stream).pipe(fs.createWriteStream(tmpFile.path))
        } catch (e) {
            if (tmpFile) {
                tmpFile.remove();
            }
            throw e;
        }
        return tmpFile;
    }

    public static async copyUploadedImage(uploadedFile: UploadedFile, tmpFile?: TempFile): Promise<TempFile> {
        if (!tmpFile) {
            tmpFile = await this.file();
        }
        try {
            await uploadedFile.mv(tmpFile.path);
        } catch (e) {
            if (tmpFile) {
                tmpFile.remove();
            }
            throw e;
        }
        return tmpFile;
    }

}
