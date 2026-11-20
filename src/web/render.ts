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
  /** Acción a la derecha del título de la página. */
  accion?: string;
  cuerpo: string;
}

const ENTRADAS = [
  { id: "inicio", nombre: "Inicio", href: "/" },
  { id: "proyectos", nombre: "Proyectos", href: "/proyectos" },
  { id: "reuniones", nombre: "Reuniones", href: "/reuniones" },
  { id: "rubrica", nombre: "Rúbricas", href: "/rubrica" },
];

export function pagina(p: Pagina): string {
  const nav = ENTRADAS.map((e) => {
    const activo = e.id === p.seccion ? " activo" : "";
    const conteo = e.id === "reuniones" && p.conteoBandeja ? `<span class="conteo">${p.conteoBandeja}</span>` : "";
    return `<a href="${e.href}" class="${e.id}${activo}">${e.nombre}${conteo}</a>`;
  }).join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
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
  <header class="cabecera"><h1>${esc(p.titulo)}</h1>
    ${p.accion ? `<span class="cabecera-accion">${p.accion}</span>` : ""}
  </header>
  <section class="contenido">${p.cuerpo}</section>
</main>
<script src="/app.js"></script>
</body>
</html>`;
}
