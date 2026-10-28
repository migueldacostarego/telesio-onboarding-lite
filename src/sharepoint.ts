import type { Client } from '@microsoft/microsoft-graph-client';
import { DirectoryError, wrap } from './directory';

export interface FolderResult {
  id: string;
  webUrl: string | null;
  /** false : le dossier existait déjà (appel idempotent). */
  created: boolean;
}

export interface Library {
  ensureFolder(name: string): Promise<FolderResult>;
}

/** Dossiers à la racine d'une bibliothèque d'un seul site (permission Sites.Selected). */
export class GraphSharePoint implements Library {
  private readonly root: string;

  constructor(
    private readonly client: Pick<Client, 'api'>,
    siteId: string,
    driveId: string,
  ) {
    // Ids validés au chargement de la config. Le chemin lie le drive au site : 404 si non appariés.
    this.root = `/sites/${siteId}/drives/${driveId}/root`;
  }

  async ensureFolder(name: string): Promise<FolderResult> {
    try {
      const item = await this.client
        .api(`${this.root}/children`)
        .post({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
      return { id: item.id as string, webUrl: (item.webUrl ?? null) as string | null, created: true };
    } catch (err) {
      const e = wrap(err);
      if (e.statusCode !== 409) throw e;
    }
    // Le nom existe déjà : idempotent seulement si c'est bien un dossier.
    try {
      const item = await this.client.api(`${this.root}:/${encodeURIComponent(name)}`).get();
      if (!item.folder) throw new DirectoryError('conflict', 409, 'notAFolder');
      return { id: item.id as string, webUrl: (item.webUrl ?? null) as string | null, created: false };
    } catch (err) {
      throw err instanceof DirectoryError ? err : wrap(err);
    }
  }
}
