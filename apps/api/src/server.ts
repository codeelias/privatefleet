import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startSimulator } from "./modules/demo/simulator.js";

const config = loadConfig();
const { app, demo } = buildApp(config);

try {
  await app.listen({ port: config.port, host: config.host });
  if (config.demoMode && demo) {
    startSimulator(demo.store, demo.bus);
    app.log.info("demo simulator started (2s tick)");
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
