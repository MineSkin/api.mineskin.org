/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    testEnvironment: "node",
    transform: {
        "^.+.tsx?$": ["ts-jest", {}],
    },
    modulePathIgnorePatterns: [
        "<rootDir>/dist/",
        "<rootDir>/src/",
        "<rootDir>/node_modules/",
    ],
};