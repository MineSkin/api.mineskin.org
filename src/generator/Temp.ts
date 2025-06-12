import * as fs from "fs";
import * as path from "path";
import * as tmp from "tmp";
import { DirOptions, FileOptions } from "tmp";
import { Stream } from "stream";
import { IMAGE_FETCH, Requests } from "./Requests";
import { isTempFile, PathHolder } from "../util";
import ExifTransformer from "exif-be-gone/index";

export const URL_DIR = "url";
export const UPL_DIR = "upl";
export const USR_DIR = "usr";
export const MOJ_DIR = "moj";
export const MLT_DIR = "mlt";

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

    static tmpdir = tmp.tmpdir;

    static mkdirs() {
        console.log("Creating temp directories in " + tmp.tmpdir);
        try {
            fs.mkdirSync(tmp.tmpdir + path.sep + URL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(tmp.tmpdir + path.sep + UPL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(tmp.tmpdir + path.sep + MOJ_DIR);
        } catch (e) {
        }
    }

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

    public static async downloadImage(url: string, tmpFile?: PathHolder, breadcrumb?: string): Promise<PathHolder> {
        if (!tmpFile) {
            tmpFile = await this.file();
        }
        try {
            const response = await Requests.dynamicRequest(IMAGE_FETCH, {
                method: "GET",
                url: url,
                responseType: "stream",
                timeout: 2000,
                headers: {
                    "User-Agent": "MineSkin/Image-Downloader"
                },
                maxContentLength: 20000, // 20KB
                maxBodyLength: 20000, // 20KB
                maxRedirects: 0
            }, breadcrumb);
            // (response.data as Stream).pipe(fs.createWriteStream(tmpFile.path))
            await new Promise((resolve, reject) => {
                (response.data as Stream)
                    .pipe(new ExifTransformer()) // strip metadata
                    .pipe(fs.createWriteStream(tmpFile.path))
                    .on("finish", resolve)
                    .on("error", reject);
            });
        } catch (e) {
            if (isTempFile(tmpFile)) {
                tmpFile.remove();
            }
            throw e;
        }
        return tmpFile;
    }

    public static async copyUploadedImage(uploadedFile: Express.Multer.File, tmpFile?: PathHolder): Promise<PathHolder> {
        if (!tmpFile) {
            tmpFile = await this.file();
        }
        if (process.env.NODE_ENV === "development") {
            return uploadedFile;
        }
        try {
            // move file
            await new Promise((resolve, reject) => {
                fs.rename(uploadedFile.path, tmpFile.path, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(tmpFile);
                    }
                });
            });
        } catch (e) {
            if (isTempFile(tmpFile)) {
                tmpFile.remove();
            }
            throw e;
        }
        return tmpFile;
    }

}
