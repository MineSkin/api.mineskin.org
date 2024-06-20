module.exports = {
    apps: [{
        name: "mineskin",
        script: "dist/index.js",
        args: ["--color", "--time"],
        time: true,
        interpreter: "node@18.20.3",
        max_memory_restart: "300M"
    }]
}
