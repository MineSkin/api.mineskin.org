import { IApiKeyDocument } from "./db/IApiKeyDocument";

export class ApiKeyRequest {
    apiKeyStr?: string;
    apiKey?: IApiKeyDocument;
}

export function isApiKeyRequest(obj: any): obj is ApiKeyRequest {
    return "apiKeyStr" in obj;
}
