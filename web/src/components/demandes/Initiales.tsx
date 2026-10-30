import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/auth';

/** Teintes douces et désaturées (fond clair, texte foncé : contraste AA) : elles aident à repérer une personne d'un coup d'œil, sans rien dire à elles seules. */
const TEINTES = [
  'bg-[oklch(0.93_0.04_250)] text-[oklch(0.32_0.09_250)]',
  'bg-[oklch(0.93_0.04_160)] text-[oklch(0.32_0.08_160)]',
  'bg-[oklch(0.94_0.05_80)] text-[oklch(0.36_0.08_70)]',
  'bg-[oklch(0.93_0.04_330)] text-[oklch(0.34_0.09_330)]',
  'bg-[oklch(0.93_0.03_200)] text-[oklch(0.32_0.07_200)]',
  'bg-[oklch(0.94_0.03_30)] text-[oklch(0.36_0.09_30)]',
] as const;

const teinte = (id: string): string => TEINTES[[...id].reduce((somme, c) => (somme + c.charCodeAt(0)) % TEINTES.length, 0)] as string;

/** Pastille d'initiales d'une personne (décorative : le nom est toujours écrit à côté). */
export function Initiales({ id, nom, taille = 'default' }: { id: string; nom: string; taille?: 'sm' | 'default' | 'lg' }) {
  return (
    <Avatar aria-hidden="true" size={taille}>
      <AvatarFallback className={`font-medium ${teinte(id)}`}>{initials(nom, null)}</AvatarFallback>
    </Avatar>
  );
}
