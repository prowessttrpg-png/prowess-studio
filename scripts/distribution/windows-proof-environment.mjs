import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function requireOrdinaryWindowsAccount(observed, processId) {
  if (observed?.processId !== processId) throw new Error("Windows host evidence must describe the probe process.");
  if (observed.productType !== 1 || !Number.isInteger(observed.build) || observed.build < 22000 ||
      typeof observed.caption !== "string" || !/\bWindows 11\b/i.test(observed.caption) || typeof observed.version !== "string" ||
      observed.nativeMachine !== 0x8664 || observed.processMachine !== 0) {
    throw new Error("The feasibility proof requires a native x64 Windows 11 workstation.");
  }
  // TokenElevationTypeDefault means there is no linked elevation token.
  if (observed.isElevated !== false || observed.isAdministrator !== false || observed.elevationType !== 1) {
    throw new Error("Run the proof from a standard Windows user account with an unelevated token.");
  }
  return {
    os: { caption: observed.caption, version: observed.version, build: observed.build, architecture: "x64" },
    process: { id: processId, architecture: "x64", elevated: observed.isElevated, administrator: observed.isAdministrator, elevationType: "Default" },
  };
}

export function inspectWindowsProofEnvironment(systemRoot, env) {
  const powershell = path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const script = readFileSync(path.join(import.meta.dirname, "windows-proof-environment.ps1"), "utf8");
  const command = Buffer.from("$targetProcessId = " + process.pid + "\n" + script, "utf16le").toString("base64");
  const report = execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command], {
    env, encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "inherit"],
  });
  return requireOrdinaryWindowsAccount(JSON.parse(report), process.pid);
}
