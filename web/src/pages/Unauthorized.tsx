import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LOGOUT_URL } from '@/lib/auth';

export function Unauthorized() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold tracking-tight">Accès non autorisé</h1>
        </CardTitle>
        <CardDescription>
          Votre compte n’a aucun droit sur cette application. Demandez l’accès à un administrateur, ou connectez-vous avec un autre compte.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="self-start">
          <a href={LOGOUT_URL}>Se déconnecter</a>
        </Button>
      </CardContent>
    </Card>
  );
}
