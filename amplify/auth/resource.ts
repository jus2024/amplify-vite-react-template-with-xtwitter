import { defineAuth, secret } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      oidc: [
        {
          name: "XTwitter",
          clientId: secret("X_CLIENT_ID"),
          clientSecret: secret("X_CLIENT_SECRET"),
          // ★ 手順 2 で取得した API Gateway URL を設定
          issuerUrl: "https://obwlvwk7cd.execute-api.us-west-2.amazonaws.com/prod",
          scopes: ["openid", "tweet.read", "users.read", "offline.access"],
          attributeMapping: {
            email: "email",
            preferredUsername: "preferred_username",
            profilePicture: "picture",
          },
        },
      ],
      callbackUrls: [
        "http://localhost:3000/",
        // ★ 手順 2 で取得した Amplify URL を設定
        "https://main.d2fc7iwbfufchb.amplifyapp.com",
      ],
      logoutUrls: [
        "http://localhost:3000/",
        "https://main.d2fc7iwbfufchb.amplifyapp.com",
      ],
    },
  },
});