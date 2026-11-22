import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

async function startServer(): Promise<void> {
  const env = loadEnv();
  const app = buildApp();

  // Graceful shutdown handling
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, initiating graceful shutdown...`);
      try {
        await app.close();
        app.log.info('Fastify API Gateway shut down successfully.');
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'Error during server shutdown');
        process.exit(1);
      }
    });
  }

  try {
    const address = await app.listen({
      port: env.SERVER_PORT,
      host: env.SERVER_HOST,
    });
    app.log.info(`Fastify API Gateway listening at ${address}`);
  } catch (err) {
    app.log.fatal({ err }, 'Failed to start API Gateway');
    process.exit(1);
  }
}

// Only execute when run directly
startServer();
