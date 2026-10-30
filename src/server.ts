import { createApp } from './app';
import { createAudit } from './audit';
import { assertReady, loadConfig } from './config';
import { GraphDirectory } from './directory';
import { createGraphClient } from './graph';
import { KeyedLock } from './lock';
import { GraphSharePoint } from './sharepoint';
import { demarrerTerminaisonAuto } from './terminaison';

const config = assertReady(loadConfig());
const audit = createAudit();
const { client: graph, warmUp } = createGraphClient(audit);
const { siteId, driveId } = config.sharePoint;
const directory = new GraphDirectory(graph);
// Un seul verrou pour les routes et la tâche : une action RH et la terminaison ne touchent jamais le même compte en même temps.
const lock = new KeyedLock();
const app = createApp({
  config,
  directory,
  library: siteId && driveId ? new GraphSharePoint(graph, siteId, driveId) : undefined,
  audit,
  lock,
});

// Passage à Terminé : une tâche de l'application, pas l'écran (voir src/terminaison.ts : une seule instance, pas de verrou partagé).
// Sans le groupe des arrivants ou l'extension d'activation (activation fermée), elle ne démarre pas.
const terminaisonPossible = config.terminaisonIntervalMs > 0 && config.arrivantsGroupId !== undefined && config.activationExtension !== undefined;
const arreterTerminaison = terminaisonPossible ? demarrerTerminaisonAuto({ config, directory, audit }, lock, { intervalleMs: config.terminaisonIntervalMs }) : () => {};

const server = app.listen(config.port, () => {
  console.log(`telesio-onboarding-lite à l'écoute sur le port ${config.port}`);
  if (terminaisonPossible) console.log(`passage à Terminé : une tâche toutes les ${Math.round(config.terminaisonIntervalMs / 60_000)} min`);
  void warmUp();
});

process.on('SIGTERM', () => {
  arreterTerminaison();
  server.close(() => void audit.flush().finally(() => process.exit(0)));
});
