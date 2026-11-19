import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, vistaPrevia } from "../src/web/markdown.ts";

test("convierte títulos con jerarquía", () => {
  const html = renderMarkdown("# Contexto\n## Detalle\n### Sub");
  assert.match(html, /<h2>Contexto<\/h2>/);
  assert.match(html, /<h3>Detalle<\/h3>/);
  assert.match(html, /<h4>Sub<\/h4>/);
});

test("convierte listas con viñeta y numeradas", () => {
  const html = renderMarkdown("- uno\n- dos\n\n1. primero\n2. segundo");
  assert.match(html, /<ul>[\s\S]*<li>uno<\/li>[\s\S]*<\/ul>/);
  assert.match(html, /<ol>[\s\S]*<li>primero<\/li>[\s\S]*<\/ol>/);
});

test("aplica negrita, cursiva y código", () => {
  const html = renderMarkdown("Esto es **fuerte**, *suave* y `codigo`.");
  assert.match(html, /<strong>fuerte<\/strong>/);
  assert.match(html, /<em>suave<\/em>/);
  assert.match(html, /<code>codigo<\/code>/);
});

test("escapa HTML: nada de inyección", () => {
  const html = renderMarkdown('<script>alert(1)</script> y <img onerror=x>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("un separador se convierte en hr", () => {
  assert.match(renderMarkdown("texto\n---\nmás"), /<hr>/);
});

test("líneas vacías cierran la lista", () => {
  const html = renderMarkdown("- uno\n\ndespués");
  assert.match(html, /<\/ul>\s*<p>después<\/p>/);
});

test("la vista previa quita marcas y se queda con cuatro líneas", () => {
  const texto = "# Contexto\nEl cliente quiere la landing.\n## Detalle\n- Medir vanos\n- Firmar acta\n- Otra cosa más";
  const previa = vistaPrevia(texto, 4);
  assert.doesNotMatch(previa, /#/);
  assert.match(previa, /Contexto/);
  assert.match(previa, /Medir vanos/);
  assert.doesNotMatch(previa, /acta/);
  assert.doesNotMatch(previa, /Otra cosa más/);
});

test("la vista previa recorta por caracteres", () => {
  const previa = vistaPrevia("a".repeat(500), 4, 50);
  assert.equal(previa.length, 51);
  assert.match(previa, /…$/);
});
