import cors from "cors"
import process from "node:process";

const ALLOWED_HEADERS = ["Content-Type", "Authorization"];

export const wildcardCors = cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const wildcardCorsWithCredentials = cors({
    origin: requestOrigin => {
        return requestOrigin ? requestOrigin : "*";
    },
    credentials: true,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const webOnlyCors = cors({
    origin: process.env.WEB_CORS!.split(','),
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const webOnlyCorsWithCredentials = cors({
    origin: process.env.WEB_CORS!.split(','),
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const mineskinOnlyCors = cors({
    origin: requestOrigin => {
        return requestOrigin?.endsWith("mineskin.org") ? requestOrigin : "";
    },
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const mineskinOnlyCorsWithCredentials = cors({
    origin: requestOrigin => {
        return requestOrigin?.endsWith("mineskin.org") ? requestOrigin : "";
    },
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});