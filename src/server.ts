import { createApp } from './app';
import { createAudit } from './audit';
import { assertReady, loadConfig } from './config';
import { GraphDirectory } from './directory';
import { createGraphClient } from './graph';
import { GraphSharePoint } from './sharepoint';

const config = assertReady(loadConfig());
const audit = createAudit();
const graph = createGraphClient();
const { siteId, driveId } = config.sharePoint;
const app = createApp({
  config,
  directory: new GraphDirectory(graph),
  library: siteId && driveId ? new GraphSharePoint(graph, siteId, driveId) : undefined,
  audit,
});

const server = app.listen(config.port, () => {
  console.log(`telesio-onboarding-lite à l'écoute sur le port ${config.port}`);
});

process.on('SIGTERM', () => {
  server.close(() => void audit.flush().finally(() => process.exit(0)));
});
