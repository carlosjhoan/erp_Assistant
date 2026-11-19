/** Escape y plantilla del layout. Nada de dependencias. */

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface Pagina {
  titulo: string;
  seccion: string;
  /** <num> por mostrar al lado de la entrada de la bandeja. */
  conteoBandeja?: number;
  cuerpo: string;
}

const ENTRADAS = [
  { id: "bandeja", nombre: "Bandeja", href: "/" },
  { id: "reuniones", nombre: "Reuniones", href: "/reuniones" },
  { id: "rubrica", nombre: "Rúbrica", href: "/rubrica" },
  { id: "temas", nombre: "Temas", href: "/temas" },
  { id: "repos", nombre: "Repos", href: "/repos" },
  { id: "trazas", nombre: "Trazas", href: "/trazas" },
];

export function pagina(p: Pagina): string {
  const nav = ENTRADAS.map((e) => {
    const activo = e.id === p.seccion ? " activo" : "";
    const conteo = e.id === "bandeja" && p.conteoBandeja ? `<span class="conteo">${p.conteoBandeja}</span>` : "";
    return `<a href="${e.href}" class="${e.id}${activo}">${e.nombre}${conteo}</a>`;
  }).join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.titulo)} · my_erp</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<aside class="rail">
  <div class="rail-head">
    <img class="brand-mark" src="/logo-mark.png" alt="Steel and Glass">
  </div>
  <nav class="nav">${nav}</nav>
</aside>
<main class="principal">
  <header class="cabecera"><h1>${esc(p.titulo)}</h1></header>
  <section class="contenido">${p.cuerpo}</section>
</main>
<script src="/app.js"></script>
</body>
</html>`;
}
