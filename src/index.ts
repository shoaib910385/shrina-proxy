import 'dotenv/config';
import app from './app.js';
import { SERVER } from './config/constants.js';
import { logger } from './middleware.js';

// Pull environment settings
const PORT = process.env.PORT || 3000;
const USE_CLOUDFLARE = process.env.USE_CLOUDFLARE === 'true';

// -------------------------------------------------------------
// ✅ Export app for Vercel serverless
// -------------------------------------------------------------
//
// Vercel automatically wraps this exported handler in an HTTP
// server. Do NOT call http.createServer() or app.listen() here.
//
export default app;

// -------------------------------------------------------------
// 🧩 Local development mode
// -------------------------------------------------------------
//
// When running locally (e.g. `npm run dev`), we still start
// an HTTP server manually so you can test it at localhost.
//
if (process.env.NODE_ENV !== 'production') {
  const server = app.listen(PORT, () => {
    logger.info(
      {
        type: 'server',
        port: PORT,
        env: SERVER.NODE_ENV,
        cloudflare: USE_CLOUDFLARE,
      },
      `Server is running locally at http://localhost:${PORT}`
    );
  });

  // Graceful shutdown for local environment
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, () => {
      logger.info(
        { type: 'server', signal },
        'Shutting down local server...'
      );

      server.close(() => {
        logger.info({ type: 'server' }, 'Server closed cleanly.');
        process.exit(0);
      });

      // Force exit after timeout
      setTimeout(() => {
        logger.error(
          { type: 'server' },
          'Server did not close gracefully. Forcing exit.'
        );
        process.exit(1);
      }, 10000).unref();
    });
  });
}
