/**
 * Renderer mínimo de markdown para las notas de Granola.
 *
 * Soporta lo que las notas usan: títulos (#), listas (- y 1.), énfasis
 * (**negrita**, *cursiva*), código en línea y separadores. No es un parser
 * completo: no hay tablas, imágenes, ni HTML embebido (se escapa todo).
 */

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Énfasis y código, aplicado sobre texto YA escapado. */
function enLinea(texto: string): string {
  return texto
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

export function renderMarkdown(fuente: string): string {
  const lineas = fuente.replace(/\r\n/g, "\n").split("\n");
  const salida: string[] = [];
  let enLista: "ul" | "ol" | null = null;

  const cerrarLista = () => {
    if (enLista) {
      salida.push(`</${enLista}>`);
      enLista = null;
    }
  };

  for (const cruda of lineas) {
    const linea = cruda.trimEnd();
    const limpia = linea.trim();

    if (limpia === "") {
      cerrarLista();
      continue;
    }

    // Separador
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(limpia)) {
      cerrarLista();
      salida.push("<hr>");
      continue;
    }

    // Título: # a ####
    const titulo = /^(#{1,4})\s+(.*)$/.exec(limpia);
    if (titulo) {
      cerrarLista();
      const nivel = Math.min(6, titulo[1]!.length + 1); // # → h2 (el h1 es el de la página)
      salida.push(`<h${nivel}>${enLinea(escapar(titulo[2]!))}</h${nivel}>`);
      continue;
    }

    // Lista ordenada
    const ordenada = /^\d+[.)]\s+(.*)$/.exec(limpia);
    if (ordenada) {
      if (enLista !== "ol") {
        cerrarLista();
        salida.push("<ol>");
        enLista = "ol";
      }
      salida.push(`<li>${enLinea(escapar(ordenada[1]!))}</li>`);
      continue;
    }

    // Lista con viñeta
    const vineta = /^[-*+]\s+(.*)$/.exec(limpia);
    if (vineta) {
      if (enLista !== "ul") {
        cerrarLista();
        salida.push("<ul>");
        enLista = "ul";
      }
      salida.push(`<li>${enLinea(escapar(vineta[1]!))}</li>`);
      continue;
    }

    // Párrafo (una línea suelta)
    cerrarLista();
    salida.push(`<p>${enLinea(escapar(limpia))}</p>`);
  }

  cerrarLista();
  return salida.join("\n");
}

/** Las primeras N líneas con contenido, en texto plano, para el vistazo. */
export function vistaPrevia(fuente: string, lineas = 4, maxChars = 320): string {
  const utiles = fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^#{1,4}\s+/, "").replace(/^[-*+]\s+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, lineas);

  const texto = utiles.join(" · ");
  return texto.length > maxChars ? texto.slice(0, maxChars).trimEnd() + "…" : texto;
}
