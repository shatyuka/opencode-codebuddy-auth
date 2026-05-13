import type { Plugin, Hooks, Config } from '@opencode-ai/plugin';
import { requestAuthState, getAuthToken, getLoginAccount, refreshAccessToken, getConfig } from './codebuddy.js'
import { CODEBUDDY_ENDPOINT, CODEBUDDY_PROVIDER, CODEBUDDY_CLI_VERSION } from './constants.js';
import { loadStorage, saveStorage } from './storage.js';

export const CodeBuddyAuthPlugin: Plugin = async (input) => {
  return {
    auth: {
      provider: CODEBUDDY_PROVIDER,
      loader: async (getAuth, provider) => {
        const latestAuth = await getAuth();
        if (latestAuth.type != 'oauth')
          return {};

        let storage = await loadStorage();
        if (storage) {
          let auth = storage.auth;
          let account = storage.account;
          if (Date.now() < auth.refreshExpiresAt) {
            const refreshed = await refreshAccessToken(auth.accessToken, auth.refreshToken, auth.domain, account.uid, account.enterpriseId);
            if (refreshed) {
              auth = {
                accessToken: refreshed.accessToken,
                expiresAt: Date.now() + refreshed.expiresIn * 1000,
                refreshToken: refreshed.refreshToken,
                refreshExpiresAt: Date.now() + refreshed.refreshExpiresIn * 1000,
                domain: refreshed.domain,
              };
              account = {
                uid: account.uid,
                nickname: account.nickname,
                enterpriseId: account.enterpriseId,
                departmentFullName: account.departmentFullName,
              };
              storage = {
                auth,
                account,
              };
              await saveStorage(storage);
            }
          }
        }

        return {
          apiKey: '',
          fetch: async (input: string | URL | Request, init?: RequestInit) => {
            const url = input.toString();
            if (!url.endsWith('/chat/completions'))
              return fetch(input, init);

            if (init && init.headers) {
              const headers = new Headers(init?.headers);
              headers.set('user-agent', `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`);
              init.headers = headers;
            }

            return fetch(input, init);
          }
        }
      },
      methods: [
        {
          label: 'Browser Login',
          type: 'oauth',
          authorize: async () => {
            const authState = await requestAuthState();
            return {
              url: authState.authUrl,
              instructions: 'Complete sign-in in your browser.',
              method: 'auto',
              async callback() {
                const token = await getAuthToken(authState.state);
                if (!token) {
                  return {
                    type: 'failed'
                  }
                }

                const account = await getLoginAccount(authState.state, token.accessToken, token.domain)
                if (!account) {
                  return {
                    type: 'failed'
                  }
                }

                await saveStorage({
                  auth: {
                    accessToken: token.accessToken,
                    expiresAt: Date.now() + token.expiresIn * 1000,
                    refreshToken: token.refreshToken,
                    refreshExpiresAt: Date.now() + token.refreshExpiresIn * 1000,
                    domain: token.domain,
                  },
                  account: {
                    uid: account.uid,
                    nickname: account.nickname,
                    enterpriseId: account.enterpriseId,
                    departmentFullName: account.departmentFullName,
                  }
                });

                return {
                  type: 'success',
                  access: token.accessToken,
                  refresh: token.refreshToken,
                  expires: Date.now() + token.expiresIn * 1000,
                }
              },
            }
          }
        }
      ]
    },
    config: async (config: Config) => {
      const providers = config.provider || {};
      providers[CODEBUDDY_PROVIDER] = {
        npm: '@ai-sdk/openai-compatible',
        name: 'CodeBuddy',
        options: {baseURL: `${CODEBUDDY_ENDPOINT}/v2`},
        models: {
          'auto': {
            id: 'auto',
            name: 'Auto'
          }
        }
      };
      const provider = providers[CODEBUDDY_PROVIDER];
      config.provider = providers;

      let storage = await loadStorage();
      if (!storage)
        return;

      const auth = storage.auth;
      const account = storage.account;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${auth.accessToken}`,
        'X-Domain': `${auth.domain}`,
        'X-User-Id': `${account.uid}`,
      }
      if (account.enterpriseId != null)
        headers['X-Enterprise-Id'] = account.enterpriseId;
      provider.options!['headers'] = headers;

      try {
        const codebuddyConfig = await getConfig(auth.accessToken, auth.domain, account.uid, account.enterpriseId, account.departmentFullName);
        for (const model of codebuddyConfig.models) {
          provider.models![model.id] = {
            id: model.id,
            name: model.name,
            reasoning: model.supportsReasoning ?? false,
            tool_call: model.supportsToolCall ?? false,
            limit: {
              context: model.maxAllowedSize ?? 0,
              output: model.maxOutputTokens ?? 0,
            },
            modalities: {
              input: model.supportsImages ? ['text', 'image'] : ['text'],
              output: model.supportsImages ? ['text', 'image'] : ['text']
            },
          };
        }
      } catch {
      }
    }
  } satisfies Hooks;
}
