const { spawnSync } = require("node:child_process");
const electron = require("electron");

const result = spawnSync(electron, ["--test", "tests/documents.test.cjs"], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
