

interface Expiring {
    expires: number;
    issued: number;
}

export interface MicrosoftAuthInfo {
    auth: MicrosoftAuthResponse;
    userToken: UserTokenResponse;
    identities: {
        mc: IdentityResponse;
        xbox: IdentityResponse;
    }
}

/*
>>>
POST https://login.live.com/oauth20_token.srf

<<<
 {
   "token_type":"bearer",
   "expires_in":86400,
   "scope":"XboxLive.signin",
   "access_token":"token here",
   "refresh_token":"M.R3_BAY.token here",
   "user_id":"889ed4a3d844f672",
   "foci":"1"
 }
 */
export interface MicrosoftAuthResponse extends Expiring {
    accessToken: string;
    refreshToken: string;
    userId: string;
}

/*
>>>
POST https://user.auth.xboxlive.com/user/authenticate
 {
    "Properties": {
        "AuthMethod": "RPS",
        "SiteName": "user.auth.xboxlive.com",
        "RpsTicket": "d=<access token>" // your access token from step 2 here
    },
    "RelyingParty": "http://auth.xboxlive.com",
    "TokenType": "JWT"
 }

<<<
{
   "IssueInstant":"2020-12-07T19:52:08.4463796Z",
   "NotAfter":"2020-12-21T19:52:08.4463796Z",
   "Token":"token", // save this, this is your xbl token
   "DisplayClaims":{
      "xui":[
         {
            "uhs":"userhash" // save this
         }
      ]
   }
 }
 */
export interface UserTokenResponse extends Expiring {
    token: string;
    userHash: string;
}

/*
>>>
 POST https://xsts.auth.xboxlive.com/xsts/authorize
 {
    "Properties": {
        "SandboxId": "RETAIL",
        "UserTokens": [
            "xbl_token" // from above
        ]
    },
    "RelyingParty": "rp://api.minecraftservices.com/",
    "TokenType": "JWT"
 }

 <<<
  {
   "IssueInstant":"2020-12-07T19:52:09.2345095Z",
   "NotAfter":"2020-12-08T11:52:09.2345095Z",
   "Token":"token", // save this, this is your xsts token
   "DisplayClaims":{
      "xui":[
         {
            "uhs":"userhash" // same as last request
         }
      ]
   }
}
 */
export interface IdentityResponse extends Expiring {
    token: string;
    claims: {
        [claim: string]: any;
    }
}


