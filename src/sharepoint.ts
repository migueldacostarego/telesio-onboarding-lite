import type { Client } from '@microsoft/microsoft-graph-client';
import { DirectoryError, wrap } from './directory';

export interface FolderResult {
  id: string;
  webUrl: string | null;
  /** false : le dossier existait déjà (appel idempotent). */
  created: boolean;
}

/** Noms (en minuscules : SharePoint ne distingue pas la casse) des dossiers de la racine de la bibliothèque. */
export interface FolderNames {
  noms: Set<string>;
  /** false : la liste a été coupée au plafond de pages, l'absence d'un nom ne prouve rien. */
  complet: boolean;
}

export interface Library {
  ensureFolder(name: string): Promise<FolderResult>;
  /** Lecture seule, une requête paginée pour toute la racine (pas une par compte). */
  listFolderNames(): Promise<FolderNames>;
  /** Lecture seule : l'adresse du dossier de ce nom, ou null s'il n'existe pas (ou si ce n'est pas un dossier). */
  findFolder(name: string): Promise<{ webUrl: string | null } | null>;
}

/** Pages de 999 suivies au plus par lecture de la racine : au-delà, la liste est marquée incomplète. */
const MAX_PAGES = 10;

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

  async listFolderNames(): Promise<FolderNames> {
    try {
      const noms = new Set<string>();
      let req = this.client.api(`${this.root}/children`).select('name,folder').top(999);
      for (let page = 1; ; page++) {
        const res = await req.get();
        for (const item of (res?.value ?? []) as { name?: string; folder?: object }[]) {
          if (item.folder && typeof item.name === 'string') noms.add(item.name.toLowerCase());
        }
        const next = res?.['@odata.nextLink'] as string | undefined;
        if (!next) return { noms, complet: true };
        if (page >= MAX_PAGES) return { noms, complet: false };
        req = this.client.api(next);
      }
    } catch (err) {
      throw wrap(err);
    }
  }

  async findFolder(name: string): Promise<{ webUrl: string | null } | null> {
    try {
      const item = await this.client.api(`${this.root}:/${encodeURIComponent(name)}`).get();
      return item.folder ? { webUrl: (item.webUrl ?? null) as string | null } : null;
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return null;
      throw e;
    }
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
