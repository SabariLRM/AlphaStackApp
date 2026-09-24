import { buildApp } from './app.js';
import { createContext, createWorker } from './bootstrap.js';
import { loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const ctx = await createContext(config);
  for (const warning of config.warnings) ctx.log.warn({}, warning);
  ctx.log.info({ smsProvider: config.sms.provider, otpProvider: config.otp.provider, domain: config.mailDomain }, 'starting PhoneMail API');

  const app = await buildApp(ctx);
  const worker = createWorker(ctx);
  if (config.workerEnabled) worker.start();
  await app.listen({ port: config.port, host: config.host });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.log.info({ signal }, 'shutting down');
    ctx.realtime.closeAll();
    await worker.stop();
    await app.close();
    await ctx.db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
