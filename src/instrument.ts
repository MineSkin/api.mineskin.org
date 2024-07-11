import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { resolveHostname } from "./util";

const hostname = resolveHostname();

console.log("Initializing Sentry")
Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SOURCE_COMMIT || "unknown",
    integrations: [
        nodeProfilingIntegration()
    ],
    serverName: hostname,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    sampleRate: 0.8,
    ignoreErrors: [
        "No duplicate found",
        "Invalid image file size",
        "Invalid image dimensions",
        "Failed to find image from url",
        "Invalid file size",
        "invalid_image"
    ]
});