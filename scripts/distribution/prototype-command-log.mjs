import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

export function runWithLog(executable, args, { cwd, env, timeout, logFile }) {
  const log = openSync(logFile, "a");
  try {
    execFileSync(executable, args, { cwd, env, timeout, windowsHide: true, stdio: ["ignore", log, log] });
  } finally {
    closeSync(log);
  }
}
