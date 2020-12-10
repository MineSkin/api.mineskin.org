module.exports = {
    authenticate: "https://authserver.mojang.com/authenticate",
    refresh: "https://authserver.mojang.com/refresh",
    validate: "https://authserver.mojang.com/validate",
    signout: "https://authserver.mojang.com/signout",
    skin: "https://api.minecraftservices.com/minecraft/profile/skins",
    security: {
        challenges: "https://api.mojang.com/user/security/challenges",
        location: "https://api.mojang.com/user/security/location"
    },
    microsoft: {
        oauth20auth: "https://login.live.com/oauth20_authorize.srf" +
            "?client_id=00000000402b5328" +
            "&response_type=code" +
            "&scope=" + encodeURIComponent("service::user.auth.xboxlive.com::MBI_SSL") +
            "&redirect_uri=" + encodeURIComponent("https://login.live.com/oauth20_desktop.srf"),
        oauth20prefix: "https://login.live.com/oauth20_desktop.srf?code=",
        oauth20token: "https://login.live.com/oauth20_token.srf",
        xblAuth: "https://user.auth.xboxlive.com/user/authenticate",
        xstsAuth: "https://xsts.auth.xboxlive.com/xsts/authorize",
        loginWithXbox: "https://api.minecraftservices.com/authentication/login_with_xbox",
        entitlements: "https://api.minecraftservices.com/entitlements/mcstore",
        profile: "https://api.minecraftservices.com/minecraft/profile"
    }
};
