import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Vienna Thursday API listening on port ${config.port}`);
});
