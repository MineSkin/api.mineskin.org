module.exports = {
    authenticate: "https://authserver.mojang.com/authenticate",
    refresh: "https://authserver.mojang.com/refresh",
    validate: "https://authserver.mojang.com/validate",
    signout: "https://authserver.mojang.com/signout",
    skin: "https://api.mojang.com/user/profile/:uuid/skin",
    security: {
        challenges: "https://api.mojang.com/user/security/challenges",
        location: "https://api.mojang.com/user/security/location"
    },
    microsoft: {
        oauth20auth: "https://login.live.com/oauth20_authorize.srf" +
            "?client_id=00000000402b5328" +
            "&response_type=code" +
            "&scope=service%3A%3Auser.auth.xboxlive.com%3A%3AMBI_SSL" +
            "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf",
        oauth20prefix: "https://login.live.com/oauth20_desktop.srf?code=",
        oauth20token: "https://login.live.com/oauth20_token.srf",
        xblAuth: "https://user.auth.xboxlive.com/user/authenticate",
        xstsAuth: "https://xsts.auth.xboxlive.com/xsts/authorize",
        loginWithXbox: "https://api.minecraftservices.com/authentication/login_with_xbox",
        entitlements: "https://api.minecraftservices.com/entitlements/mcstore",
        profile: "https://api.minecraftservices.com/minecraft/profile"
    }
};
