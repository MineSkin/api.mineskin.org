const MS_CLIENT_ID = "6e8d323a-5420-4d19-bf69-66c7704e361e";
const MS_REDIRECT_URL = "https://api.mineskin.org/accountManager/auth/microsoft/oauth/callback";

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
        clientId: MS_CLIENT_ID,
        redirectUrl: MS_REDIRECT_URL,
        oauth20auth: "https://login.live.com/oauth20_authorize.srf" +
            "?client_id=" + MS_CLIENT_ID +
            "&response_type=code" +
            "&scope=XboxLive.signin" +
            "&redirect_uri=" + encodeURIComponent(MS_REDIRECT_URL),
        oauth20prefix: "https://login.live.com/oauth20_desktop.srf?code=",
        oauth20token: "https://login.live.com/oauth20_token.srf",
        xblAuth: "https://user.auth.xboxlive.com/user/authenticate",
        xstsAuth: "https://xsts.auth.xboxlive.com/xsts/authorize",
        loginWithXbox: "https://api.minecraftservices.com/authentication/login_with_xbox",
        entitlements: "https://api.minecraftservices.com/entitlements/mcstore",
        profile: "https://api.minecraftservices.com/minecraft/profile"
    }
};
