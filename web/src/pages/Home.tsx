import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SCREENS } from '@/lib/screens';

export function Home() {
  return (
    <section aria-labelledby="accueil-titre" className="space-y-6">
      <div className="space-y-1">
        <h2 id="accueil-titre" className="text-2xl font-semibold tracking-tight">
          Accueil
        </h2>
        <p className="text-muted-foreground">
          Les écrans ci-dessous passent progressivement sur cette nouvelle interface. D’ici là, les pages actuelles restent en service.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map((screen) => (
          <li key={screen.path}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{screen.titre}</CardTitle>
                <CardDescription>{screen.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex-row items-center justify-between gap-2">
                <Badge variant="secondary">{screen.role}</Badge>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/${screen.path}`}>
                    Ouvrir<span className="sr-only"> : {screen.titre}</span>
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
