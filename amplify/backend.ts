import { defineBackend, secret } from '@aws-amplify/backend';
import { CDKContextKey } from '@aws-amplify/platform-core';
import { Construct } from 'constructs';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { XOidcProxyConstruct } from './custom-resources/x-oidc-proxy/construct';

const backend = defineBackend({
  auth,
  data,
});

// X OIDC プロキシの CDK コンストラクトを追加
const proxyStack = backend.createStack('XOidcProxyStack');

const backendIdentifier = {
  namespace: proxyStack.node.getContext(CDKContextKey.BACKEND_NAMESPACE) as string,
  name: proxyStack.node.getContext(CDKContextKey.BACKEND_NAME) as string,
  type: proxyStack.node.getContext(CDKContextKey.DEPLOYMENT_TYPE) as 'sandbox' | 'branch',
};

const xClientIdSecret = secret('X_CLIENT_ID');
const xClientSecretSecret = secret('X_CLIENT_SECRET');

new XOidcProxyConstruct(proxyStack as unknown as Construct, 'XOidcProxy', {
  xClientId: xClientIdSecret.resolve(proxyStack, backendIdentifier).unsafeUnwrap(),
  xClientSecret: xClientSecretSecret.resolve(proxyStack, backendIdentifier).unsafeUnwrap(),
});