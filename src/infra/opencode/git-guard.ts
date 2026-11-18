import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface Snapshot {
  head: string | null;
  /** Archivos con cambios sin commitear, ordenados. */
  archivos: string[];
  /** true si la carpeta no es un repo git o git falló. */
  sinGit: boolean;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function snapshot(repoPath: string): Snapshot {
  if (!existsSync(repoPath)) return { head: null, archivos: [], sinGit: true };

  const head = git(repoPath, ["rev-parse", "HEAD"]);
  const status = git(repoPath, ["status", "--porcelain"]);

  if (head === null && status === null) return { head: null, archivos: [], sinGit: true };

  return {
    head,
    archivos: (status ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .sort(),
    sinGit: false,
  };
}

/**
 * Compara dos fotos del repo. Un agente de solo lectura no debería mover ni el
 * HEAD ni los archivos sin commitear.
 */
export function compararSnapshots(antes: Snapshot, despues: Snapshot): { headCambio: boolean; archivos: string[] } {
  if (antes.sinGit || despues.sinGit) return { headCambio: false, archivos: [] };

  const nuevos = despues.archivos.filter((a) => !antes.archivos.includes(a));
  const desaparecidos = antes.archivos.filter((a) => !despues.archivos.includes(a));

  return {
    headCambio: antes.head !== despues.head,
    archivos: [...new Set([...nuevos, ...desaparecidos])],
  };
}

export function estaContaminado(cambio: { headCambio: boolean; archivos: string[] }): boolean {
  return cambio.headCambio || cambio.archivos.length > 0;
}
