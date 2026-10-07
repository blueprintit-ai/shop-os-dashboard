#!/usr/bin/env node
import { runInstall } from "../installer/run-install.js";

runInstall().then(({ exitCode }) => { process.exitCode = exitCode; }).catch((e) => {
  console.error(`Setup stopped unexpectedly: ${e?.message ?? e}`);
  process.exitCode = 1;
});
