import { z } from 'zod';
import { erreurEmail } from '@/lib/email';
import { aujourdhui } from '@/lib/suivi';
import { TYPES_CONTRAT } from '@/lib/typeContrat';

// CSP de /app sans 'unsafe-eval' : zod compile ses schémas avec `new Function` s'il le peut, et sonde pour cela (la CSP signale
// la sonde comme violation, même interceptée). `jitless` : aucune compilation, aucune sonde. À garder avant tout schéma.
z.config({ jitless: true });

/**
 * Formulaire « Nouvelle demande » : mêmes règles que `validateDemande` côté serveur (src/validation.ts), qui reste l'autorité
 * (fuseau métier, identifiant formé du prénom et du nom, disponibilité de l'adresse, licence déduite du type) : ses erreurs 400
 * s'affichent sous chaque champ. Plus de licence dans le formulaire : le serveur la déduit du type de contrat.
 */
export const LIMITES = { prenom: 64, nom: 64, poste: 128, service: 64 } as const;
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

const texte = (libelle: string, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(1, `${libelle} requis`)
        .max(max, `${max} caractères au plus`)
        .refine((s) => !CONTROLE.test(s), 'caractères non autorisés'),
    );

const dateReelle = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/** `domaine` : celui des adresses (GET /api/moi). */
export const schemaDemande = (domaine: string) =>
  z.object({
    prenom: texte('Prénom', LIMITES.prenom),
    nom: texte('Nom', LIMITES.nom),
    email: z
      .string()
      .transform((s) => s.trim().toLowerCase())
      .refine((s) => erreurEmail(s, domaine) === null, { error: (issue) => erreurEmail(String(issue.input), domaine) ?? 'Adresse invalide' }),
    typeContrat: z.enum(TYPES_CONTRAT, { error: 'Choisissez un type de contrat' }),
    dateArrivee: z
      .string()
      .refine(dateReelle, 'Date d’arrivée requise')
      // Jour du navigateur : un garde-fou de confort, le serveur tranche d'après le fuseau métier.
      .refine((s) => !dateReelle(s) || s >= aujourdhui(), 'La date d’arrivée ne peut pas être dans le passé'),
    poste: texte('Poste', LIMITES.poste),
    service: texte('Service', LIMITES.service),
    managerId: z.string().regex(GUID, 'Choisissez le responsable dans la liste'),
  });

export type DemandeEntree = z.input<ReturnType<typeof schemaDemande>>;
export type DemandeSortie = z.output<ReturnType<typeof schemaDemande>>;
/** Dans l'ordre de la page : le premier champ en erreur reçoit le focus. */
export const CHAMPS = ['prenom', 'nom', 'email', 'typeContrat', 'dateArrivee', 'poste', 'service', 'managerId'] as const;
export type Champ = (typeof CHAMPS)[number];
export const estChamp = (c: string): c is Champ => (CHAMPS as readonly string[]).includes(c);

/** Réponse de POST /api/demandes (201). */
export interface DemandeCreee {
  id: string;
  userPrincipalName: string;
  statut: string;
  /** `manager_non_affecte` : le compte existe, le responsable est à poser dans Entra (ne pas renvoyer la demande). */
  avertissement?: string;
}
