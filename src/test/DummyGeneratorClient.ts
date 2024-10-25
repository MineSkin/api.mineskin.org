import { IGeneratorClient, QueueOptions } from "@mineskin/generator";
import { IQueueDocument, Queue } from "@mineskin/database";
import { GenerateRequest, GenerateResult } from "@mineskin/types";
import { Types } from "mongoose";

export class DummyGeneratorClient implements IGeneratorClient<IQueueDocument> {

    static imageHash = "b5f517958dc379e908f39ca50413c059e9143facefc012501662cfa5251a6e48";

    static jobs = new Map<string, IQueueDocument>();

    async insertUploadedImage(hash: string, data: Buffer): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    async submitRequest(request: GenerateRequest, options: QueueOptions): Promise<IQueueDocument> {
        const doc = new Queue({
            _id: new Types.ObjectId(),
            request: request,
            status: "waiting",
            priority: options.priority,
            flags: options.flags || null,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        DummyGeneratorClient.jobs.set(`${ doc._id }`, doc);
        return doc;
    }

    async getJob(jobId: string): Promise<IQueueDocument> {
        return DummyGeneratorClient.jobs.get(jobId)!;
    }

    async waitForJob(jobId: string, timeout: number): Promise<GenerateResult> {
        return DummyGeneratorClient.jobs.get(jobId)!.result!;
    }

    async getByUser(userId: string): Promise<IQueueDocument[]> {
        throw new Error("Method not implemented.");
    }

    async getByApiKey(keyId: string): Promise<IQueueDocument[]> {
        throw new Error("Method not implemented.");
    }

    async getPendingCount(): Promise<number> {
        return 1;
    }

    async getPendingCountByUser(userId: string): Promise<number> {
        return 1;
    }

    async getPendingCountByIp(ip: string): Promise<number> {
        return 1;
    }

}