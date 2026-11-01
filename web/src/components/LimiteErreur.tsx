import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Phrase affichée à la place de l'enfant en erreur (jamais le message de l'exception : il pourrait contenir une donnée). */
  message: string;
  className?: string;
  /** Affiché avant le message, dans l'état d'erreur seulement (ex. titre accessible d'une fenêtre dont le contenu normal en portait un). */
  entete?: ReactNode;
}

/**
 * Sans limite d'erreur, une exception de rendu (ou un chunk introuvable après un redéploiement : le serveur répond 404 aux anciens
 * fichiers hachés, voulu) démonte toute la racine : page blanche, boîte du mot de passe temporaire comprise. Ici seule la zone
 * enveloppée est remplacée par un message et un bouton qui recharge la page. Le composant n'écrit rien lui-même (ni console, ni stockage) ; le message de l'exception n'est jamais affiché.
 */
export class LimiteErreur extends Component<Props, { erreur: boolean }> {
  override state = { erreur: false };

  static getDerivedStateFromError(): { erreur: boolean } {
    return { erreur: true };
  }

  override render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <>
        {this.props.entete}
        <Alert variant="destructive" className={this.props.className}>
          <AlertTitle>Une erreur est survenue</AlertTitle>
          <AlertDescription>
            <p>{this.props.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => window.location.reload()}>
              Recharger la page
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }
}

/**
 * Pour les pages : la limite repart à zéro à chaque changement d'adresse (clé = chemin). Sans cela, une exception de rendu sur une page
 * garderait l'alerte affichée après un clic sur le logo ou « précédent », jusqu'au rechargement.
 */
export function LimiteErreurParPage(props: Props) {
  const { pathname } = useLocation();
  return <LimiteErreur key={pathname} {...props} />;
}
