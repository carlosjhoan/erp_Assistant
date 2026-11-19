/** Teclado y acciones de la bandeja. Vanilla, cero framework. */

const filas = [...document.querySelectorAll<HTMLElement>(".fila[data-id]")];
let foco = -1;

function enfocar(i: number) {
  if (i < 0 || i >= filas.length) return;
  filas[foco]?.classList.remove("foco");
  foco = i;
  const f = filas[foco]!;
  f.classList.add("foco");
  f.scrollIntoView({ block: "nearest" });
}

async function accion(accion: string, fila: HTMLElement) {
  const id = fila.dataset.id!;
  const r = await fetch(`/accion/${id}/${accion}`, { method: "POST" });
  if (!r.ok) {
    const texto = await r.text();
    alert(texto);
    return;
  }
  // La decisión saca la fila de la bandeja: se recarga.
  location.reload();
}

filas.forEach((f, i) => {
  f.addEventListener("mouseenter", () => enfocar(i));
  f.querySelectorAll<HTMLButtonElement>("button.tecla").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      accion(b.dataset.accion!, f);
    });
  });
});

document.addEventListener("keydown", (e) => {
  if (filas.length === 0) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  const actual = filas[foco];

  if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); enfocar(foco + 1); return; }
  if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); enfocar(foco - 1); return; }

  if (!actual) { if (e.key === "j" || e.key === "ArrowDown") enfocar(0); return; }

  const teclas: Record<string, string> = { e: "selected", p: "parked", d: "discarded", c: "opencode", m: "me" };
  const accion = teclas[e.key.toLowerCase()];
  if (accion && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    accion(accion, actual);
  }
});
