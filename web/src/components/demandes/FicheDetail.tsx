import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BoutonCopier } from '@/components/demandes/Adresse';
import type { DemandeDetail } from '@/lib/detail';
import { formatInstant } from '@/lib/dates';
import { PAYS } from '@/lib/pays';
import { formatArrivee } from '@/lib/suivi';

const ABSENT = <span className="text-muted-foreground">Non renseigné</span>;
const ouAbsent = (valeur: ReactNode | undefined) => valeur ?? ABSENT;

function Rubrique({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section aria-label={titre} className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{titre}</h2>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

const Ligne = ({ libelle, children }: { libelle: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{libelle}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </>
);

const LIBELLES_LICENCE = { choisie: 'prévue, attribuée à la validation', attribuee: 'attribuée', en_cours: 'attribution en cours', erreur: 'attribution en erreur', inconnu: 'état illisible' } as const;

function Licence({ d }: { d: DemandeDetail }) {
  if (!d.licence) return ABSENT;
  return (
    <>
      {d.licence.libelle ?? 'Licence retirée de la liste'} <span className="text-muted-foreground">: {LIBELLES_LICENCE[d.licence.etat]}</span>
    </>
  );
}

function estHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function Dossier({ d }: { d: DemandeDetail }) {
  if (d.statut === 'EnAttente') return <span className="text-muted-foreground">Créé à la validation</span>;
  if (!d.dossier) return <span className="text-muted-foreground">Indisponible</span>;
  if (d.dossier.etat === 'absent') return <span className="text-destructive">Non créé</span>;
  // L'adresse vient de Graph : seule une adresse https devient un lien (jamais javascript: ni une adresse mal formée).
  if (!d.dossier.url || !estHttps(d.dossier.url)) return <>Créé</>;
  return (
    <a href={d.dossier.url} target="_blank" rel="noopener noreferrer" className="inline-flex flex-wrap items-center gap-x-1 rounded-sm font-medium underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      Ouvrir dans SharePoint
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

function Groupe({ d }: { d: DemandeDetail }) {
  if (d.statut === 'EnAttente') return <span className="text-muted-foreground">Ajouté à la validation</span>;
  if (!d.groupeArrivants) return <span className="text-muted-foreground">Indisponible</span>;
  return <>{d.groupeArrivants.membre ? 'Membre' : 'Non membre'}</>;
}

const ETATS_SALESFORCE = {
  ok: { texte: 'OK', classe: 'text-green-800' },
  ko: { texte: 'KO', classe: 'text-destructive' },
  en_attente: { texte: 'En attente', classe: 'text-muted-foreground' },
  hors_perimetre: { texte: '—', classe: 'text-muted-foreground' },
  illisible: { texte: 'Indisponible', classe: 'text-muted-foreground' },
} as const;

/** Statut d'après les journaux de provisionnement d'Entra (quelques minutes de retard) ; la raison d'un échec ou d'une attente, l'email du responsable envoyé. */
function Salesforce({ s }: { s: NonNullable<DemandeDetail['salesforce']> }) {
  const etat = ETATS_SALESFORCE[s.etat];
  return (
    <span className="space-y-0.5">
      <span className={`block font-medium ${etat.classe}`}>
        {etat.texte}
        {s.le && <span className="font-normal text-muted-foreground"> · {formatInstant(s.le)}</span>}
      </span>
      {s.raison && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{s.raison}</span>}
      {s.etat !== 'hors_perimetre' && (
        <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">Manager envoyé : {s.emailResponsable ?? 'aucun'}</span>
      )}
    </span>
  );
}

function Email({ d }: { d: DemandeDetail }) {
  if (!d.upn) return ABSENT;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="[overflow-wrap:anywhere]">{d.upn}</span>
      <BoutonCopier upn={d.upn} nom={d.nom} />
    </span>
  );
}

/** Rubrique « Identité » de la page de détail : ce que la demande dit de la personne qui arrive. */
export function Identite({ d }: { d: DemandeDetail }) {
  return (
    <Rubrique titre="Identité">
      <Ligne libelle="E-mail">
        <Email d={d} />
      </Ligne>
      <Ligne libelle="Type de contrat">{ouAbsent(d.typeContrat)}</Ligne>
      <Ligne libelle="Pays">{ouAbsent(d.pays ? PAYS[d.pays] : null)}</Ligne>
      <Ligne libelle="Trigramme">{ouAbsent(d.trigramme ?? null)}</Ligne>
      <Ligne libelle="Poste">{ouAbsent(d.poste)}</Ligne>
      <Ligne libelle="Service">{ouAbsent(d.service)}</Ligne>
      <Ligne libelle="Responsable">{ouAbsent(d.manager?.nom)}</Ligne>
      <Ligne libelle="Arrivée">{d.dateArrivee ? formatArrivee(d.dateArrivee) : ABSENT}</Ligne>
    </Rubrique>
  );
}

/** Rubrique « Compte et accès » : licence, groupe des arrivants et dossier SharePoint, tels que Graph les a rendus. */
export function CompteEtAcces({ d }: { d: DemandeDetail }) {
  return (
    <Rubrique titre="Compte et accès">
      <Ligne libelle="Licence">
        <Licence d={d} />
      </Ligne>
      <Ligne libelle="Arrivants">
        <Groupe d={d} />
      </Ligne>
      <Ligne libelle="Dossier">
        <Dossier d={d} />
      </Ligne>
      {d.salesforce && (
        <Ligne libelle="Salesforce">
          <Salesforce s={d.salesforce} />
        </Ligne>
      )}
    </Rubrique>
  );
}
