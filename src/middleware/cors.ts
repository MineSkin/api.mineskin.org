import cors from "cors"
import process from "node:process";

const ALLOWED_HEADERS = ["Content-Type", "Authorization", "User-Agent", "MineSkin-User-Agent", "Origin", "Turnstile-Token", "Baggage", "Sentry-Trace"];

const WEB_WHITELIST = process.env.WEB_CORS!.split(',');

export const wildcardCors = cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const wildcardCorsWithCredentials = cors({
    origin: (requestOrigin, callback) => {
        callback(null, requestOrigin);
    },
    credentials: true,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const webOnlyCors = cors({
    origin: (requestOrigin, callback) => {
        if (requestOrigin && WEB_WHITELIST.includes(requestOrigin)) {
            callback(null, requestOrigin);
            return;
        }
        callback(null, false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const webOnlyCorsWithCredentials = cors({
    origin: (requestOrigin, callback) => {
        if (requestOrigin && WEB_WHITELIST.includes(requestOrigin)) {
            callback(null, requestOrigin);
            return;
        }
        callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const mineskinOnlyCors = cors({
    origin: (requestOrigin, callback) => {
        if (requestOrigin?.endsWith("mineskin.org")) {
            callback(null, requestOrigin);
            return;
        }
        callback(null, false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});

export const mineskinOnlyCorsWithCredentials = cors({
    origin: (requestOrigin, callback) => {
        if (requestOrigin?.endsWith("mineskin.org")) {
            callback(null, requestOrigin);
            return;
        }
        callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ["Content-Type"]
});