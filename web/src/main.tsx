import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { appliquerNonce } from '@/lib/nonce';
import { createQueryClient } from '@/lib/query';
import './index.css';

// Avant tout rendu : les <style> créés à l'exécution par Radix (menus et fenêtres modaux) portent le nonce de la CSP.
appliquerNonce();

const queryClient = createQueryClient();
const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Même préfixe que `base` (vite.config.ts) et que le montage Express. */}
      <BrowserRouter basename="/app">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
