module.exports = {
    apps: [{
        name: "mineskin",
        script: "dist/index.js",
        args: ["--color", "--time"],
        max_memory_restart: "300M"
    }]
}
