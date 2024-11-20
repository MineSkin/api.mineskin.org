export const HOSTNAME = resolveHostname();

export function resolveHostname() {
    if (process.env.NODE_HOSTNAME && !process.env.NODE_HOSTNAME.startsWith("{{")) {
        // docker swarm
        console.log("Using NODE_HOSTNAME: " + process.env.NODE_HOSTNAME);
        return process.env.NODE_HOSTNAME;
    }
    if (process.env.HOST_HOSTNAME) {
        console.log("Using HOST_HOSTNAME: " + process.env.HOST_HOSTNAME);
        return process.env.HOST_HOSTNAME;
    }
    if (process.env.HOSTNAME) {
        console.log("Using HOSTNAME: " + process.env.HOSTNAME);
        return process.env.HOSTNAME;
    }
    console.warn("Could not resolve hostname");
    return "unknown";
}
