import { CODEBUDDY_ENDPOINT, CODEBUDDY_PLATFORM, CODEBUDDY_IDE_VERSION } from './constants.js'

interface ResponseBase {
  code: number;
  msg: string;
  requestId: string;
}

interface AuthState {
  state: string;
  authUrl: string;
}

interface AuthStateResponse extends ResponseBase {
  data?: AuthState;
}

interface AuthToken {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  domain: string;
}

interface AuthTokenResponse extends ResponseBase {
  data?: AuthToken;
}

interface Account {
  uid: string;
  nickname: string;
  enterpriseId?: string;
  departmentFullName?: string;
}

interface AccountResponse extends ResponseBase {
  data?: Account;
}

interface Config {
  models: Model[];
}

interface Model {
  id: string;
  name: string;
  maxAllowedSize?: number;
  maxOutputTokens?: number;
  supportsImages?: boolean;
  supportsToolCall?: boolean;
  supportsReasoning?: boolean;
}

interface ConfigResponse extends ResponseBase {
  data?: Config;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function requestAuthState() {
  const response = await fetch(
    `${CODEBUDDY_ENDPOINT}/v2/plugin/auth/state?platform=${CODEBUDDY_PLATFORM}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-No-Authorization': 'true',
        'X-No-User-Id': 'true',
        'X-No-Enterprise-Id': 'true',
      },
    },
  );
  if (!response.ok)
    throw new Error('Request auth state failed');
  const data = (await response.json()) as AuthStateResponse;
  if (data.code !== 0 || !data.data)
    throw new Error(`Request auth state failed: ${data.code} - ${data.msg}`);
  return data.data;
}

export async function getAuthToken(state: string) {
  const timeout = Date.now() + 60 * 10 * 1000;
  while (Date.now() < timeout) {
    await delay(1000);
    try {
      const response = await fetch(
        `${CODEBUDDY_ENDPOINT}/v2/plugin/auth/token?state=${state}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-No-Authorization': 'true',
          }
        },
      );
      if (response.ok) {
        const data = (await response.json()) as AuthTokenResponse;
        if (data.code === 11217)
          continue;
        if (data.code !== 0)
          return null;
        return data.data;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function getLoginAccount(state: string, accessToken: string, domain: string) {
  const response = await fetch(
    `${CODEBUDDY_ENDPOINT}/v2/plugin/login/account?state=${state}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-No-User-Id': 'true',
        'X-No-Enterprise-Id': 'true',
        'X-Domain': domain,
      },
    },
  );
  if (!response.ok)
    throw new Error('Request login account failed');
  const data = (await response.json()) as AccountResponse;
  if (data.code !== 0 || !data.data)
    throw new Error(`Request login account failed: ${data.code} - ${data.msg}`);
  return data.data;
}

export async function refreshAccessToken(accessToken: string, refreshToken: string, domain: string, uid: string, enterpriseId?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Domain': domain,
    'X-User-Id': uid,
    'X-Refresh-Token': refreshToken,
  };
  if (enterpriseId != null)
    headers['X-Enterprise-Id'] = enterpriseId;
  const response = await fetch(
    `${CODEBUDDY_ENDPOINT}/v2/plugin/auth/token/refresh`,
    {
      method: 'POST',
      headers,
    },
  );
  if (!response.ok)
    return null;
  const data = (await response.json()) as AuthTokenResponse;
  if (data.code !== 0 || !data.data)
    return null;
  return data.data;
}

export async function getConfig(accessToken: string, domain: string, uid: string, enterpriseId?: string, departmentFullName?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': `CodeBuddyIDE/${CODEBUDDY_IDE_VERSION} CodeBuddy/${CODEBUDDY_IDE_VERSION}`,
    'X-Domain': domain,
    'X-User-Id': uid,
  };
  if (enterpriseId != null)
    headers['X-Enterprise-Id'] = enterpriseId;
  if (departmentFullName != null)
    headers['X-Department-Info'] = departmentFullName;
  const response = await fetch(
    `${CODEBUDDY_ENDPOINT}/v3/config`,
    {
      method: 'GET',
      headers,
    },
  );
  if (!response.ok)
    throw new Error('Get config failed');
  const data = (await response.json()) as ConfigResponse;
  if (data.code !== 0 || !data.data)
    throw new Error(`Get config failed: ${data.code} - ${data.msg}`);
  return data.data;
}
