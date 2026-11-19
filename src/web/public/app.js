/** Selectores por fila. Sin teclado: la decisión se ve y se elige. */

document.querySelectorAll<HTMLElement>(".fila[data-id]").forEach((fila) => {
  const id = fila.dataset.id!;

  fila.querySelectorAll<HTMLSelectElement>("select[data-campo]").forEach((select) => {
    // Guarda el valor previo para poder volver si el servidor rechaza.
    select.dataset.previo = select.value;

    select.addEventListener("change", async () => {
      const campo = select.dataset.campo!;
      const valor = select.value;
      const anterior = select.dataset.previo ?? "";

      select.disabled = true;

      try {
        const r = await fetch(`/accion/${id}/${campo}/${encodeURIComponent(valor)}`, { method: "POST" });
        const datos = (await r.json()) as { ok?: boolean; error?: string; estado?: string };

        if (!r.ok || !datos.ok) {
          throw new Error(datos.error ?? "No se pudo guardar");
        }

        select.dataset.previo = valor;

        // Si la decisión la saca de la bandeja, la fila se va.
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
