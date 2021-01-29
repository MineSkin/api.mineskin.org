module.exports = {
    apps: [{
        name: "mineskin",
        script: "dist/index.js",
        args: ["--color", "--time"],
        interpreter: "node@14.15.4",
        max_memory_restart: "300M"
    }]
}
