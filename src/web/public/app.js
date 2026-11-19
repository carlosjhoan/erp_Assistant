/** Selectores por fila y acciones de la rúbrica. Sin teclado: todo visible. */

function actualizarConteo() {
  const restantes = document.querySelectorAll(".fila[data-id]").length;
  const globo = document.querySelector(".nav .conteo");
  if (globo) globo.textContent = String(restantes);

  if (restantes === 0) {
    const cont = document.querySelector(".contenido");
    if (cont) {
      cont.innerHTML =
        '<div class="vacio"><h2>No hay temas por calificar</h2><p>La bandeja está limpia. Todo el alcance de las reuniones ya fue decidido.</p></div>';
    }
  }
}

async function llamar(ruta: string): Promise<{ ok?: boolean; error?: string } & Record<string, unknown>> {
  const r = await fetch(ruta, { method: "POST" });
  const datos = (await r.json()) as { ok?: boolean; error?: string };
  if (!r.ok || !datos.ok) throw new Error(datos.error ?? "No se pudo guardar");
  return datos;
}

/* ---------- bandeja ---------- */

document.querySelectorAll<HTMLElement>(".fila[data-id]").forEach((fila) => {
  const id = fila.dataset.id!;

  fila.querySelectorAll<HTMLSelectElement>("select[data-campo]").forEach((select) => {
    select.dataset.previo = select.value;

    select.addEventListener("change", async () => {
      const campo = select.dataset.campo!;
      const valor = select.value;
      const anterior = select.dataset.previo ?? "";
      select.disabled = true;

      try {
        await llamar(`/accion/${id}/${campo}/${encodeURIComponent(valor)}`);
        select.dataset.previo = valor;

        if (campo === "estado" && valor !== "proposed") {
          fila.classList.add("saliendo");
          setTimeout(() => {
            fila.remove();
            actualizarConteo();
          }, 220);
          return;
        }
      } catch (e) {
        select.value = anterior;
        alert(e instanceof Error ? e.message : String(e));
      } finally {
        select.disabled = false;
      }
    });
  });
});

/* ---------- botones de acción ---------- */

document.querySelectorAll<HTMLElement>("[data-accion]").forEach((boton) => {
  boton.addEventListener("click", async () => {
    const accion = boton.dataset.accion!;
    boton.setAttribute("disabled", "true");

    try {
      if (accion === "crear-rubrica") {
        await llamar("/rubrica/crear");
        location.reload();
        return;
      }

      if (accion === "aprobar") {
        const id = boton.dataset.rubrica!;
        await llamar(`/rubrica/aprobar/${id}`);
        location.reload();
        return;
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      boton.removeAttribute("disabled");
    }
  });
});

/* ---------- detalle del tema ---------- */

const cargando = document.querySelector<HTMLElement>(".cargando");

function ocupado(si: boolean) {
  if (cargando) cargando.hidden = !si;
}

document.querySelectorAll<HTMLButtonElement>("[data-guardar-contexto]").forEach((b) => {
  b.addEventListener("click", async () => {
    const id = b.dataset.guardarContexto!;
    const area = document.querySelector<HTMLTextAreaElement>(`textarea[data-contexto="${id}"]`);
    if (!area) return;
    b.disabled = true;
    try {
      await llamarTexto(`/tema/${id}/contexto`, area.value);
      b.textContent = "Guardado ✓";
      setTimeout(() => (b.textContent = "Guardar contexto"), 1600);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      b.disabled = false;
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-detectar]").forEach((b) => {
  b.addEventListener("click", async () => {
    const id = b.dataset.detectar!;
    b.disabled = true;
    b.textContent = "Detectando…";
    ocupado(true);
    try {
      const r = await llamar(`/tema/${id}/detectar`);
      const n = Array.isArray(r.repos) ? (r.repos as unknown[]).length : 0;
      if (r.duda) alert(`El modelo pidió aclaración:\n\n${r.duda}`);
      if (n === 0) alert("No se determinó ningún repo.");
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      b.disabled = false;
      b.textContent = "Detectar repos";
      ocupado(false);
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-difundir]").forEach((b) => {
  b.addEventListener("click", async () => {
    const id = b.dataset.difundir!;
    if (!confirm("Se abre una sesión de OpenCode por repo. Puede tardar varios minutos. ¿Seguir?")) return;
    b.disabled = true;
    ocupado(true);
    try {
      await llamar(`/tema/${id}/difundir`);
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      b.disabled = false;
      ocupado(false);
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-aceptar]").forEach((b) => {
  b.addEventListener("click", async () => {
    const id = b.dataset.aceptar!;
    const repo = b.dataset.repo!;
    b.disabled = true;
    try {
      const r = await llamarTexto(`/tema/${id}/aceptar`, repo);
      alert(`${r.materializados ?? 0} ítem(s) creados en la rúbrica.`);
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      b.disabled = false;
    }
  });
});

async function llamarTexto(ruta: string, cuerpo: string) {
  const r = await fetch(ruta, { method: "POST", body: cuerpo, headers: { "content-type": "text/plain" } });
  const datos = (await r.json()) as { ok?: boolean; error?: string; materializados?: number };
  if (!r.ok || !datos.ok) throw new Error(datos.error ?? "No se pudo guardar");
  return datos;
}

/* ---------- nueva reunión con Granola ---------- */

const btnBuscar = document.querySelector<HTMLButtonElement>("[data-buscar-granola]");
const resultados = document.getElementById("resultados");

if (btnBuscar && resultados) {
  btnBuscar.addEventListener("click", async () => {
    btnBuscar.disabled = true;
    btnBuscar.textContent = "Buscando…";
    resultados.innerHTML = "";

    try {
      const r = await fetch("/granola/listar", { method: "POST" });
      const datos = (await r.json()) as { ok?: boolean; error?: string; notas?: Array<{ externalId: string; title: string; occurredAt: string; participantes: number; yaImportada: boolean }> };

      if (!r.ok || !datos.ok) throw new Error(datos.error ?? "No se pudo consultar Granola");
      const notas = datos.notas ?? [];

      if (notas.length === 0) {
        resultados.innerHTML = '<div class="vacio"><h2>No hay notas recientes</h2></div>';
        return;
      }

      resultados.innerHTML = notas
        .map(
          (n) => `<article class="fila">
  <div class="titulos">
    <div class="etiquetas">
      <span class="score">${new Date(n.occurredAt).toLocaleDateString("es-CO")}</span>
      <span class="score">${n.participantes} participante(s)</span>
      ${n.yaImportada ? '<span class="etiqueta alcance">ya importada</span>' : ""}
    </div>
    <h3>${escapar(n.title)}</h3>
  </div>
  <div class="controles">
    ${
      n.yaImportada
        ? ""
        : `<button class="boton" data-importar="${escapar(n.externalId)}">Importar</button>`
    }
  </div>
</article>`
        )
        .join("");

      resultados.querySelectorAll<HTMLButtonElement>("[data-importar]").forEach((b) => {
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.textContent = "Importando…";
          try {
            const resp = await fetch("/granola/importar", { method: "POST", body: b.dataset.importar! });
            const d = (await resp.json()) as { ok?: boolean; error?: string; meetingId?: string };
            if (!resp.ok || !d.ok) throw new Error(d.error ?? "No se pudo importar");
            location.href = `/reunion/${d.meetingId}`;
          } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
            b.disabled = false;
            b.textContent = "Importar";
          }
        });
      });
    } catch (e) {
      resultados.innerHTML = `<div class="nota error">${escapar(e instanceof Error ? e.message : String(e))}</div>`;
    } finally {
      btnBuscar.disabled = false;
      btnBuscar.textContent = "Buscar en Granola";
    }
  });
}

function escapar(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- detectar temas de una reunión ---------- */

document.querySelectorAll<HTMLButtonElement>("[data-detectar-temas]").forEach((b) => {
  b.addEventListener("click", async () => {
    const id = b.dataset.detectarTemas!;
    if (!confirm("Se extraen los temas de esta reunión. Puede tardar 10-20 segundos. ¿Seguir?")) return;

    b.disabled = true;
    const aviso = b.parentElement?.querySelector<HTMLElement>(".cargando");
    if (aviso) aviso.hidden = false;

    try {
      const r = await fetch(`/reunion/${id}/detectar`, { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; error?: string; extraidos?: number };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "No se pudo extraer");
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      b.disabled = false;
      if (aviso) aviso.hidden = true;
    }
  });
});
