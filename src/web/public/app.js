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
