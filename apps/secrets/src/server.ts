import { buildApp } from "./app.js";
import { loadSecretsRuntimeConfig } from "./config.js";
import { loadSecretsKeyringFromEnv } from "./keyring.js";

// No .env file loading here (contrast apps/api/src/env.ts): porting it would
// put a plaintext KEK on a developer's disk, the exact artifact this service
// exists to avoid multiplying. Local dev supplies SECRETS_KEKS on the command
// line — see README.md.
//
// Composed from two loaders rather than one (see src/config.ts and src/keyring.ts) — boot still
// fails loud on a missing or malformed KEK exactly as it did as a single call.
const config = { ...loadSecretsRuntimeConfig(), keyring: loadSecretsKeyringFromEnv() };
const app = buildApp(config);

let closeAppPromise: Promise<void> | null = null;
let isShuttingDown = false;

function closeApp(): Promise<void> {
  if (closeAppPromise) {
    return closeAppPromise;
  }

  closeAppPromise = app.close();

  return closeAppPromise;
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    await closeApp();

    return;
  }

  isShuttingDown = true;

  app.log.info({ signal }, "shutting down secrets server");

  try {
    await closeApp();
    process.exitCode = 0;
  } catch (error) {
    process.exitCode = 1;
    app.log.error({ err: error, signal }, "failed to shut down secrets server");
  }
}

function registerSignalHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}

async function startServer(): Promise<void> {
  try {
    registerSignalHandlers();

    const address = await app.listen({
      host: config.host,
      port: config.port,
    });

    app.log.info(
      { address, host: config.host, port: config.port, nodeEnv: config.nodeEnv },
      "secrets server listening",
    );
  } catch (error) {
    process.exitCode = 1;
    app.log.error({ err: error }, "failed to start secrets server");

    try {
      await closeApp();
    } catch (closeError) {
      app.log.error({ err: closeError }, "failed to close secrets server after startup error");
    }
  }
}

await startServer();
