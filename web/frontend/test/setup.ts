import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * App Bridge's `shopify` global comes from Shopify's CDN in the admin. Tests
 * get a minimal stand-in: a fixed session token, and spies for the toast and
 * resource picker.
 */
beforeEach(() => {
  vi.stubGlobal('shopify', {
    idToken: vi.fn(() => Promise.resolve('session-token')),
    toast: { show: vi.fn() },
    resourcePicker: vi.fn(),
  });
});

afterEach(() => {
  // Unmount whatever a test rendered, so tests cannot see each other's DOM.
  cleanup();
  vi.unstubAllGlobals();
});
