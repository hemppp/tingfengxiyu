/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';

// ★ 模块顶层 Mock window.matchMedia：
// gsap 的 ScrollTrigger 在模块加载（registerPlugin）时就会调用 matchMedia，
// 若放在 beforeEach 中会晚于模块导入执行，导致 "matchMedia is not a function"。
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// 全局 Mocks
beforeEach(() => {
  // Mock localStorage
  const store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
    },
    writable: true,
  });
});

// 清理所有 Mocks
afterEach(() => {
  vi.clearAllMocks();
});
