import { getNonce, setNonce } from 'get-nonce';
import { afterEach, describe, expect, it } from 'vitest';
import { appliquerNonce } from '@/lib/nonce';

const meta = (content?: string) => {
  const m = document.createElement('meta');
  m.name = 'csp-nonce';
  if (content !== undefined) m.content = content;
  document.head.append(m);
  return m;
};

afterEach(() => {
  document.head.querySelectorAll('meta[name="csp-nonce"]').forEach((m) => m.remove());
  setNonce(undefined as unknown as string);
});

describe('appliquerNonce', () => {
  it('pose le nonce de la meta pour get-nonce (lu par les <style> de Radix)', () => {
    meta('r4nd0m+Nonce/abc==');
    expect(appliquerNonce()).toBe('r4nd0m+Nonce/abc==');
    expect(getNonce()).toBe('r4nd0m+Nonce/abc==');
  });

  it('ne pose rien sans meta, avec une meta vide ou avec le marqueur non remplacé (vite dev)', () => {
    expect(appliquerNonce()).toBeUndefined();
    expect(getNonce()).toBeUndefined();
    meta('');
    expect(appliquerNonce()).toBeUndefined();
    document.head.querySelector('meta')?.remove();
    meta('__CSP_NONCE__');
    expect(appliquerNonce()).toBeUndefined();
    expect(getNonce()).toBeUndefined();
  });

  it('lit un document donné', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.head.innerHTML = '<meta name="csp-nonce" content="abc123">';
    expect(appliquerNonce(doc)).toBe('abc123');
  });
});
