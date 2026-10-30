import { useState, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { DialogueActivation } from '@/components/demandes/DialogueActivation';
import { DialogueMotDePasse } from '@/components/demandes/DialogueMotDePasse';
import { DialogueRefus } from '@/components/demandes/DialogueRefus';
import { DialogueRegeneration } from '@/components/demandes/DialogueRegeneration';
import { useActionsDemandes } from '@/hooks/useActionsDemandes';
import type { ActionAvecBoite, ActionNom } from '@/lib/actions';
import { Contexte } from '@/lib/contexteDemandes';
import { useSuivi, type Demande, type FiltreStatut, type Tri } from '@/lib/suivi';

/** Liste, actions et boîtes de dialogue, partagées par les routes (voir lib/contexteDemandes.ts). */
export function FournisseurDemandes({ children }: { children: ReactNode }) {
  const suivi = useSuivi();
  const navigate = useNavigate();
  const surDetail = useMatch('/demandes/:id');
  const [terme, setTerme] = useState('');
  const [statut, setStatut] = useState<FiltreStatut>('tous');
  const [tri, setTri] = useState<Tri>('avenir');
  const donnees = suivi.data;

  // Le mot de passe temporaire n'existe qu'ici et dans la boîte qui l'affiche : état React seulement (ni URL, ni stockage, ni cache).
  const [remise, setRemise] = useState<{ nom: string; motDePasse: string; regeneration: boolean } | null>(null);
  // La boîte de dialogue ouverte vise une demande par son id (état de la page : elle survit aux filtres, au tri et à la navigation).
  const [cible, setCible] = useState<{ action: ActionAvecBoite; id: string } | null>(null);
  const actions = useActionsDemandes(donnees?.demandes, {
    onRemise: ({ id, motDePasse, regeneration }) => {
      setRemise({ nom: donnees?.demandes.find((d) => d.id === id)?.nom ?? '', motDePasse, regeneration });
      setCible(null);
    },
    // Un refus supprime le compte : sa page n'existe plus, retour à la liste.
    onSucces: (id, action) => {
      if (action === 'refuser' && surDetail?.params.id === id) void navigate('/', { replace: true });
    },
  });
  const demandeCible = cible === null ? undefined : donnees?.demandes.find((d) => d.id === cible.id);
  const etatCible = cible === null ? undefined : actions.etats[cible.id];
  const cibleEnCours = cible !== null && etatCible?.phase === 'en_cours' && etatCible.action === cible.action;
  // La demande n'offre plus l'action (traitée ailleurs, ou disparue) : la boîte se ferme, sauf si l'action est déjà partie.
  const ouverte = cible !== null && demandeCible && (demandeCible.actions.includes(cible.action) || cibleEnCours) ? demandeCible : undefined;
  const boite = (action: ActionAvecBoite) => (cible?.action === action ? ouverte : undefined);
  const surAction = (d: Demande, action: ActionNom) => {
    if (action === 'valider') actions.valider(d.id);
    else if (action === 'reprendre') actions.reprendre(d.id);
    else setCible({ action, id: d.id });
  };

  return (
    <Contexte.Provider value={{ suivi, actions, surAction, terme, setTerme, statut, setStatut, tri, setTri }}>
      {children}
      <DialogueRefus
        demande={boite('refuser')}
        enCours={cibleEnCours}
        onFermer={() => setCible(null)}
        onConfirmer={(motif) => cible && void actions.refuser(cible.id, motif).then(() => setCible(null))}
      />
      <DialogueActivation
        demande={boite('activer')}
        enCours={cibleEnCours}
        onFermer={() => setCible(null)}
        onConfirmer={() => cible && void actions.activer(cible.id).then(() => setCible(null))}
      />
      <DialogueRegeneration
        demande={boite('regenerer')}
        enCours={cibleEnCours}
        onFermer={() => setCible(null)}
        onConfirmer={(motif) => cible && void actions.regenerer(cible.id, motif).then(() => setCible(null))}
      />
      <DialogueMotDePasse remise={remise} onFermer={() => setRemise(null)} />
    </Contexte.Provider>
  );
}
