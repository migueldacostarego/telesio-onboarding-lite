import { LogOutIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { LOGOUT_URL, initials } from '@/lib/auth';
import type { Moi } from '@/lib/moi';

/** Pastille d'initiales : décorative, le nom est dit par l'étiquette du bouton. */
function UserAvatar({ user }: { user: Moi }) {
  return (
    <Avatar aria-hidden="true">
      <AvatarFallback className="bg-primary-foreground font-medium text-primary">{initials(user.nom, user.email)}</AvatarFallback>
    </Avatar>
  );
}

export function UserMenu({ user }: { user: Moi }) {
  const nom = user.nom || user.email || 'Utilisateur';
  // Toujours affiché, même sans droit : le badge dit le rôle du jeton, il n'en déduit rien.
  const roles = user.roles;
  return (
    // Non modal : le mode modal injecte un <style> à l'exécution (verrouillage du défilement), bloqué par la CSP.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Menu utilisateur, ${nom}${roles.length ? `, ${roles.join(', ')}` : ''}`}
        className="flex items-center gap-2 rounded-md p-1 pr-2 outline-none hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground data-[state=open]:bg-primary-foreground/10"
      >
        <UserAvatar user={user} />
        <span className="hidden max-w-48 truncate text-sm font-medium sm:inline">{nom}</span>
        {roles.map((role) => (
          <Badge key={role} variant="secondary" className="hidden sm:inline-flex">
            {role}
          </Badge>
        ))}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel className="space-y-1.5 py-2">
          <span className="block truncate text-sm font-medium text-foreground">{nom}</span>
          {user.email && <span className="block truncate text-sm font-normal text-muted-foreground">{user.email}</span>}
          {roles.length > 0 && (
            <span className="flex flex-wrap gap-1 pt-0.5">
              {roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role}
                </Badge>
              ))}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={LOGOUT_URL}>
            <LogOutIcon />
            Se déconnecter
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pendant le chargement de /api/moi : même encombrement que le menu, pour que rien ne saute. */
export function UserMenuSkeleton() {
  return (
    <div role="status" className="flex items-center gap-2 p-1 pr-2">
      <span className="sr-only">Chargement de votre profil…</span>
      <Skeleton className="size-8 rounded-full bg-primary-foreground/25" />
      <Skeleton className="hidden h-4 w-28 bg-primary-foreground/25 sm:block" />
      <Skeleton className="hidden h-5 w-10 rounded-full bg-primary-foreground/25 sm:block" />
    </div>
  );
}
