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
  { id: "inicio", nombre: "Asistente", href: "/", icono: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.2l1.3 3.1 3.1 1.3-3.1 1.3L8 11l-1.3-3.1L3.6 6.6l3.1-1.3z" fill="currentColor"/><circle cx="12.4" cy="11.6" r="1.2" fill="currentColor" opacity=".55"/></svg>` },
  { id: "proyectos", nombre: "Proyectos", href: "/proyectos", icono: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".5"/></svg>` },
  { id: "reuniones", nombre: "Reuniones", href: "/reuniones", icono: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.6h11M5.6 2v3M10.4 2v3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>` },
  { id: "rubrica", nombre: "Rúbricas", href: "/rubrica", icono: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.6l1.3 1.3L6.6 3.6M3 9.6l1.3 1.3 2.3-2.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.6 5h4.4M8.6 10h4.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>` },
];

export function pagina(p: Pagina): string {
  const nav = ENTRADAS.map((e) => {
    const activo = e.id === p.seccion ? " activo" : "";
    const conteo = "";
    return `<a href="${e.href}" class="${e.id}${activo}"><i class="nav-i">${e.icono}</i><span>${e.nombre}</span>${conteo}</a>`;
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
  <button type="button" class="rail-toggle" id="rail-toggle" aria-pressed="false" title="Ocultar menú" aria-label="Ocultar menú">
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9.6 4.2 5.8 8l3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
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
