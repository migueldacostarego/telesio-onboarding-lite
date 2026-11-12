import { useMemo, useState, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { LimiteErreur } from '@/components/LimiteErreur';
import { DialogueActivation } from '@/components/demandes/DialogueActivation';
import { DialogueMotDePasse } from '@/components/demandes/DialogueMotDePasse';
import { DialogueRefus } from '@/components/demandes/DialogueRefus';
import { DialogueRegeneration } from '@/components/demandes/DialogueRegeneration';
import { useActionsDemandes } from '@/hooks/useActionsDemandes';
import type { ActionAvecBoite, ActionNom } from '@/lib/actions';
import { Contexte, type Nouvelle } from '@/lib/contexteDemandes';
import { useDemande } from '@/lib/detail';
import { ligneDuDetail } from '@/lib/detailDemande';
import { useSuivi, type Demande, type FiltreGroupe, type Tri } from '@/lib/suivi';

const MESSAGE_BOITE = 'Cette fenêtre n’a pas pu s’afficher. Rechargez la page ; si le problème persiste, contactez l’administrateur.';

/** Liste, actions et boîtes de dialogue, partagées par les routes (voir lib/contexteDemandes.ts). */
export function FournisseurDemandes({ children }: { children: ReactNode }) {
  const suivi = useSuivi();
  const navigate = useNavigate();
  const surDetail = useMatch('/demandes/:id');
  const idDetail = surDetail?.params.id;
  const [terme, setTerme] = useState('');
  const [groupe, setGroupe] = useState<FiltreGroupe>('tous');
  const [tri, setTri] = useState<Tri>('avenir');
  const [nouvelle, setNouvelle] = useState<Nouvelle | null>(null);
  const listees = suivi.data?.demandes;

  // Page de détail : sa lecture vit ici, avec la liste, pour que les actions de la page (boutons, boîtes, état) portent sur la même
  // ligne que celle qu'elle affiche, même absente de la liste (tronquée) ou en retard sur le détail (lib/detailDemande.ts).
  const ligneListe = idDetail === undefined ? undefined : listees?.find((d) => d.id === idDetail);
  const detail = useDemande(idDetail ?? '', { active: idDetail !== undefined, attendue: ligneListe !== undefined, synchro: ligneListe?.synchro === true });
  const lu = detail.data !== undefined && detail.data.id === idDetail ? detail.data : undefined;
  const demandes = useMemo(() => {
    if (!lu) return listees;
    const ligne = ligneDuDetail(lu, ligneListe);
    if (ligne === ligneListe) return listees;
    const base = listees ?? [];
    return ligneListe ? base.map((d) => (d.id === ligne.id ? ligne : d)) : [...base, ligne];
  }, [listees, lu, ligneListe]);
  const ligneDetail = idDetail === undefined ? undefined : demandes?.find((d) => d.id === idDetail);

  // Le mot de passe temporaire n'existe qu'ici et dans la boîte qui l'affiche : état React seulement (ni URL, ni stockage, ni cache).
  const [remise, setRemise] = useState<{ nom: string; motDePasse: string; regeneration: boolean } | null>(null);
  // La boîte de dialogue ouverte vise une demande par son id (état de la page : elle survit aux filtres, au tri et à la navigation).
  const [cible, setCible] = useState<{ action: ActionAvecBoite; id: string } | null>(null);
  const actions = useActionsDemandes(demandes, {
    onRemise: ({ id, motDePasse, regeneration }) => {
      setRemise({ nom: demandes?.find((d) => d.id === id)?.nom ?? '', motDePasse, regeneration });
      setCible(null);
    },
    // Un refus supprime le compte : sa page n'existe plus, retour à la liste.
    onSucces: (id, action) => {
      if (action === 'refuser' && idDetail === id) void navigate('/', { replace: true });
    },
  });
  const demandeCible = cible === null ? undefined : demandes?.find((d) => d.id === cible.id);
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
    <Contexte.Provider value={{ suivi, detail, ligneListe, ligneDetail, actions, surAction, terme, setTerme, groupe, setGroupe, tri, setTri, nouvelle, setNouvelle }}>
      {children}
      {/* Une limite par boîte : une exception dans l'une ne donne pas une page blanche, et n'emporte pas celle du mot de passe. */}
      <LimiteErreur message={MESSAGE_BOITE}>
        <DialogueRefus
          demande={boite('refuser')}
          enCours={cibleEnCours}
          onFermer={() => setCible(null)}
          onConfirmer={(motif) => cible && void actions.refuser(cible.id, motif).then(() => setCible(null))}
        />
      </LimiteErreur>
      <LimiteErreur message={MESSAGE_BOITE}>
        <DialogueActivation
          demande={boite('activer')}
          enCours={cibleEnCours}
          onFermer={() => setCible(null)}
          onConfirmer={() => cible && void actions.activer(cible.id).then(() => setCible(null))}
        />
      </LimiteErreur>
      <LimiteErreur message={MESSAGE_BOITE}>
        <DialogueRegeneration
          demande={boite('regenerer')}
          enCours={cibleEnCours}
          onFermer={() => setCible(null)}
          onConfirmer={(motif) => cible && void actions.regenerer(cible.id, motif).then(() => setCible(null))}
        />
      </LimiteErreur>
      <LimiteErreur message={MESSAGE_BOITE}>
        <DialogueMotDePasse remise={remise} onFermer={() => setRemise(null)} />
      </LimiteErreur>
    </Contexte.Provider>
  );
}
