import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LOGIN_URL } from '@/lib/auth';

export function SessionExpired() {
  const queryClient = useQueryClient();
  // Rien de ce qui a été lu avec l'ancienne session (noms, comptes, mot de passe temporaire) ne doit rester en mémoire.
  useEffect(() => {
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  return (
    <Card role="alert" className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold tracking-tight">Votre session a expiré</h1>
        </CardTitle>
        <CardDescription>Reconnectez-vous pour continuer. Ce qui n’a pas été enregistré n’est pas conservé.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Navigation complète : sans session, Easy Auth renvoie vers la connexion Microsoft. */}
        <Button className="self-start" onClick={() => window.location.assign(LOGIN_URL)}>Se reconnecter</Button>
      </CardContent>
    </Card>
  );
}
