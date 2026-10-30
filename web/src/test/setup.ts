import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { sessionStore } from '@/lib/session';

// jsdom n'a pas ResizeObserver, que Radix (positionnement du menu) utilise.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  sessionStore.set(false);
  vi.unstubAllGlobals();
});
