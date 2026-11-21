import type { Transport } from '../transport/base.js';
import type { AuthService } from '../services/auth.js';

export function createProxyAuthService(transport: Transport): AuthService {
  return {
    async listProviders() {
      return transport.request('auth.listProviders') as ReturnType<AuthService['listProviders']>;
    },
    async listCredentials() {
      return transport.request('auth.listCredentials') as ReturnType<AuthService['listCredentials']>;
    },
    async login(input) {
      return transport.request('auth.login', { input }) as ReturnType<AuthService['login']>;
    },
    async respond(input) {
      return transport.request('auth.respond', { input }) as ReturnType<AuthService['respond']>;
    },
    async cancelPrompt(input) {
      return transport.request('auth.cancelPrompt', { input }) as ReturnType<AuthService['cancelPrompt']>;
    },
    async cancelLogin(loginId) {
      return transport.request('auth.cancelLogin', { loginId }) as ReturnType<AuthService['cancelLogin']>;
    },
    async logout(providerId) {
      return transport.request('auth.logout', { providerId }) as ReturnType<AuthService['logout']>;
    },
  };
}
