import { act, render, renderHook } from '@testing-library/react';
import { Progression } from '@/components/demandes/Progression';
import { reinitialiserApparition, retardLigne, useApparitionInitiale, useDevientVrai } from '@/hooks/useAnimations';

describe('useDevientVrai', () => {
  it('reste faux au montage, même si la valeur est déjà vraie', () => {
    const { result } = renderHook(({ v }) => useDevientVrai(v), { initialProps: { v: true } });
    expect(result.current).toBe(false);
  });

  it('devient vrai quand la valeur passe de faux à vrai, faux si elle repasse à faux', () => {
    const { result, rerender } = renderHook(({ v }) => useDevientVrai(v), { initialProps: { v: false } });
    rerender({ v: true });
    expect(result.current).toBe(true);
    rerender({ v: false });
    expect(result.current).toBe(false);
  });
});

describe('Progression', () => {
  it('ne pulse que sur le segment qui vient d’être franchi', () => {
    const { container, rerender } = render(<Progression etape={1} />);
    expect(container.querySelectorAll('[data-pulsation]')).toHaveLength(0);
    rerender(<Progression etape={2} />);
    const pulses = container.querySelectorAll('[data-pulsation]');
    expect(pulses).toHaveLength(1);
    expect(pulses[0]).toBe(container.querySelectorAll('[aria-hidden="true"]')[1]);
  });
});

describe('useApparitionInitiale', () => {
  beforeEach(() => {
    reinitialiserApparition();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('anime le premier affichage seulement, puis plus jamais', () => {
    const premier = renderHook(({ n }) => useApparitionInitiale(n), { initialProps: { n: 0 } });
    expect(premier.result.current).toBe(true);
    premier.rerender({ n: 3 });
    act(() => vi.advanceTimersByTime(retardLigne(3) + 250));
    expect(premier.result.current).toBe(false);
    premier.unmount();
    expect(renderHook(() => useApparitionInitiale(3)).result.current).toBe(false);
  });

  it('borne le décalage des lignes', () => {
    expect(retardLigne(0)).toBe(0);
    expect(retardLigne(2)).toBe(60);
    expect(retardLigne(50)).toBe(300);
  });
});
