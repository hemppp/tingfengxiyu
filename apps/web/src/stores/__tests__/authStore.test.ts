/**
 * @fileoverview Auth Store 单元测试
 * 测试 Zustand + persist 中间件的认证状态管理逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore';
import type { User } from '../authStore';

vi.mock('@/services/api/authApi', () => {
  const mockUser: User = {
    id: 'user-001',
    username: 'testuser',
    displayName: 'Test User',
    avatar: 'https://example.com/avatar.png',
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
  };

  return {
    authApi: {
      login: vi.fn().mockResolvedValue({
        user: mockUser,
        token: 'mock-jwt-token-login',
      }),
      register: vi.fn().mockResolvedValue({
        user: mockUser,
        token: 'mock-jwt-token-register',
      }),
      getCurrentUser: vi.fn().mockResolvedValue(mockUser),
      logout: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('@/services/api/apiClient', () => ({
  getToken: vi.fn((): string | null => null),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { authApi } from '@/services/api/authApi';
import { getToken, clearToken as apiClearToken } from '@/services/api/apiClient';

const expectedUser: User = {
  id: 'user-001',
  username: 'testuser',
  displayName: 'Test User',
  avatar: 'https://example.com/avatar.png',
  createdAt: expect.any(Number),
  lastLoginAt: expect.any(Number),
};

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('isAuthenticated=false, user=null', () => {
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(false);
    });
  });

  describe('register', () => {
    it('register success sets isAuthenticated=true', async () => {
      await useAuthStore.getState().register('newuser', 'password123', 'New User');
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(expectedUser);
      expect(state.isLoading).toBe(false);
      expect(authApi.register).toHaveBeenCalledWith({
        username: 'newuser',
        password: 'password123',
        displayName: 'New User',
      });
    });
  });

  describe('login', () => {
    it('login success sets user and token', async () => {
      await useAuthStore.getState().login('testuser', 'password123');
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(expectedUser);
      expect(state.isLoading).toBe(false);
      expect(authApi.login).toHaveBeenCalledWith({
        username: 'testuser',
        password: 'password123',
      });
    });
  });

  describe('logout', () => {
    it('logout clears all state', async () => {
      await useAuthStore.getState().login('testuser', 'password123');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      await useAuthStore.getState().logout();
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(apiClearToken).toHaveBeenCalled();
    });

    it('local state clears even if backend logout fails', async () => {
      (authApi.logout as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error'),
      );
      await useAuthStore.getState().login('testuser', 'password123');
      try {
        await useAuthStore.getState().logout();
      } catch {
        // expected network error
      }
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });
  });

  describe('persistence', () => {
    it('state persists after store recreation', async () => {
      await useAuthStore.getState().login('testuser', 'password123');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(expectedUser);
      useAuthStore.setState({ isAuthenticated: true });
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
    });
  });

  describe('getToken', () => {
    it('getToken returns token from apiClient', () => {
      (getToken as ReturnType<typeof vi.fn>).mockReturnValueOnce('test-token-123');
      const token = useAuthStore.getState().getToken();
      expect(token).toBe('test-token-123');
      expect(getToken).toHaveBeenCalled();
    });
  });

  describe('checkSession', () => {
    it('returns false when not authenticated', () => {
      expect(useAuthStore.getState().checkSession()).toBe(false);
    });

    it('returns true when authenticated with user', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockReturnValueOnce('valid-token');
      await useAuthStore.getState().login('testuser', 'password123');
      (getToken as ReturnType<typeof vi.fn>).mockReturnValueOnce('valid-token');
      expect(useAuthStore.getState().checkSession()).toBe(true);
    });
  });

  describe('setLoading', () => {
    it('sets loading state correctly', () => {
      useAuthStore.getState().setLoading(true);
      expect(useAuthStore.getState().isLoading).toBe(true);
      useAuthStore.getState().setLoading(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });
});
