import { createApp } from "./infrastructure/http/app.js";
import { buildContainer } from "./infrastructure/container.js";
import { loadConfig } from "./infrastructure/config.js";

const cfg = loadConfig();
const container = await buildContainer(cfg);
createApp(cfg, container).listen(cfg.API_PORT, cfg.HOST, () => {
  console.log(`Mandate API on http://localhost:${cfg.API_PORT} (memory: ${container.modes.memory})`);
});
