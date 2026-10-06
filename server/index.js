import { createApp } from './app.js';
import { config, devTools } from './config.js';
import { startScheduler } from './scheduler.js';
import { seedDemo, DEMO_PASSWORD } from './seed.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Sats in a Bottle API on :${config.port}  [${config.isProd ? (devTools ? 'production+demo' : 'production') : 'development'} · ${config.network} · payments=${config.paymentProvider}]`);
});
if (devTools) seedDemo().then(() => console.log(`Demo accounts: alice@demo.test and bob@demo.test, password ${DEMO_PASSWORD}`)).catch((e) => console.error('[seed]', e));
startScheduler();
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
