import { IApiKeyDocument } from "@mineskin/database";

export class ApiKeyRequest {
    apiKeyStr?: string;
    apiKey?: IApiKeyDocument;
}

export function isApiKeyRequest(obj: any): obj is ApiKeyRequest {
    return "apiKeyStr" in obj;
}
