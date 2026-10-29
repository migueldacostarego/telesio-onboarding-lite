import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SCREENS } from '@/lib/screens';

export function ComingSoon() {
  const { screen: path } = useParams();
  const screen = SCREENS.find((s) => s.path === path);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {screen?.titre ?? 'Écran inconnu'}
          {screen && <Badge variant="outline">À venir</Badge>}
        </CardTitle>
        <CardDescription>
          {screen ? 'Cet écran n’est pas encore migré.' : 'Cette adresse ne correspond à aucun écran.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {/* Lien natif : la page actuelle est servie par Express, hors du routeur React. */}
        {screen && (
          <a className="underline underline-offset-4" href={screen.actuelle}>
            Utiliser la page actuelle
          </a>
        )}
        <Link className="underline underline-offset-4" to="/">
          Retour à l’accueil
        </Link>
      </CardContent>
    </Card>
  );
}
