// Wrapper que sobe Next.js + amazon-worker em paralelo, fora do bundle do Next
// (assim escapa do webpack tentar empacotar `child_process`).
//
// Usado pelo `npm run dev`. Encerrar com Ctrl+C derruba ambos.
// Em produção, PM2 gerencia separado em deploy/ecosystem.config.js — não use isto lá.

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const cwd = process.cwd();

const children = [];
let shuttingDown = false;

function startChild(name, command, env = {}) {
  // shell:true necessário para resolver `npm.cmd`/`tsx.cmd` no Windows.
  const child = spawn(command, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
    windowsHide: false,
  });

  console.log(`[dev] ${name} iniciado (pid=${child.pid ?? "?"})`);

  child.on("error", (err) => {
    console.error(`[dev] erro ao subir ${name}:`, err);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[dev] ${name} encerrou (code=${code}, signal=${signal}) — derrubando o resto.`,
    );
    shutdown(code ?? 1);
  });

  children.push({ name, child });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, child } of children) {
    if (!child.killed && child.exitCode === null) {
      try {
        if (isWindows && child.pid) {
          // taskkill /T /F garante que descendentes (worker filho do tsx) morram.
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            shell: false,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch (e) {
        console.error(`[dev] falhou ao matar ${name}:`, e);
      }
    }
  }
  // dá um respiro para os filhos morrerem
  setTimeout(() => process.exit(code ?? 0), 500);
}

const pidFiles = {
  web: join(cwd, ".dev-server.pid"),
  worker: join(cwd, ".dev-worker.pid"),
};

// Limpa pidfiles antigos.
for (const f of Object.values(pidFiles)) {
  if (existsSync(f)) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
}

const NEXT_CMD = "next dev --webpack";
const WORKER_CMD = "tsx scripts/amazon-worker.ts";

const web = startChild("next", NEXT_CMD, {
  NODE_OPTIONS: "--max-old-space-size=4096",
});
const worker = startChild("worker", WORKER_CMD, {
  AMAZON_WORKER_ID: `embedded-${process.pid}`,
});

if (web.pid) {
  try { writeFileSync(pidFiles.web, String(web.pid), "utf8"); } catch { /* ignore */ }
}
if (worker.pid) {
  try { writeFileSync(pidFiles.worker, String(worker.pid), "utf8"); } catch { /* ignore */ }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const f of Object.values(pidFiles)) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
});
