// Runs a Convex CLI command against FLOAT's deployment, e.g.
//   npm run convex -- deploy
//   npm run convex -- env set HUB_ORIGIN https://admin.livoza.org
// It maps FLOAT_CONVEX_DEPLOY_KEY to CONVEX_DEPLOY_KEY for this one command
// only, and ignores any other app's CONVEX_DEPLOY_KEY in the terminal.
// The key's value is never printed.
import { spawnSync } from "node:child_process";

const key = process.env.FLOAT_CONVEX_DEPLOY_KEY;
if (!key) {
  console.error(
    "FLOAT_CONVEX_DEPLOY_KEY is not set. Add it as an environment variable (never in a file or chat), then try again.",
  );
  process.exit(1);
}
const env = { ...process.env, CONVEX_DEPLOY_KEY: key };
delete env.CONVEX_DEPLOYMENT; // the key decides the deployment
const result = spawnSync("npx", ["convex", ...process.argv.slice(2)], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
