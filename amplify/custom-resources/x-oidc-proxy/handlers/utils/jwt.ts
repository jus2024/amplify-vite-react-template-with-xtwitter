import { SignJWT, importJWK } from 'jose';
import type { IdTokenPayload, JwkKey } from '../types.js';

/**
 * ID トークン（JWT）を RS256 署名で生成する。
 * ★ X は ID トークンを返さないため、プロキシ側で生成する必要がある
 */
export async function generateIdToken(
  payload: IdTokenPayload,
  privateKeyJwk: JsonWebKey,
  keyId: string,
): Promise<string> {
  const privateKey = await importJWK(privateKeyJwk, 'RS256');

  const jwt = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: keyId })
    .sign(privateKey);

  return jwt;
}

/**
 * RSA 公開鍵を JWKS 形式にエクスポートする。
 * Cognito が ID トークンの署名検証に使用する。
 */
export function exportPublicKeyAsJwk(
  publicKeyJwk: JsonWebKey,
  keyId: string,
): JwkKey {
  if (!publicKeyJwk.n || !publicKeyJwk.e) {
    throw new Error('Invalid RSA public key: missing n or e component');
  }

  return {
    kty: 'RSA',
    kid: keyId,
    use: 'sig',
    alg: 'RS256',
    n: publicKeyJwk.n,
    e: publicKeyJwk.e,
  };
}