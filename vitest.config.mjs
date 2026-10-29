import { defineConfig } from 'vitest/config';

// Tests du serveur seulement : web/ a sa propre configuration (jsdom) et ses propres tests.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
