import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { LimiteErreur } from '@/components/LimiteErreur';
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
        {/* Dernier filet : une exception hors des limites de l'application (fournisseur, en-tête de page) donne un message, pas une page blanche. */}
        <LimiteErreur message="L’application n’a pas pu s’afficher. Rechargez la page ; si le problème persiste, contactez l’administrateur." className="m-4 w-auto max-w-lg">
          <App />
        </LimiteErreur>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
