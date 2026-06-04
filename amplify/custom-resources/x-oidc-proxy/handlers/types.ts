/**
 * X (Twitter) OIDC プロキシ - 型定義
 */

// ID トークン（JWT）ペイロード — Cognito に返却する OIDC 準拠トークン
export interface IdTokenPayload {
  sub: string;       // X のユーザー ID
  iss: string;       // プロキシの API Gateway URL
  aud: string;       // X の client_id
  exp: number;       // 有効期限（UNIX タイムスタンプ）
  iat: number;       // 発行時刻
  email?: string;    // ダミーメール（X はメールを提供しない）
  preferred_username?: string;  // X のユーザー名
  name?: string;     // 表示名
  picture?: string;  // プロフィール画像 URL
}

// JWT ヘッダー
export interface JwtHeader {
  alg: 'RS256';
  typ: 'JWT';
  kid: string;
}

// X Users API レスポンス（GET /2/users/me）
export interface XUsersResponse {
  data: {
    id: string;
    username: string;
    name: string;
    profile_image_url?: string;
    /** ユーザーの確認済みメールアドレス（confirmed_email フィールド指定時） */
    confirmed_email?: string;
  };
}

// X トークンレスポンス（POST /2/oauth2/token）
export interface XTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

// OIDC Discovery メタデータ
export interface OidcDiscoveryMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  claims_supported: string[];
}

// JWKS レスポンス
export interface JwkKey {
  kty: 'RSA';
  kid: string;
  use: 'sig';
  alg: 'RS256';
  n: string;
  e: string;
}

export interface JwksResponse {
  keys: JwkKey[];
}