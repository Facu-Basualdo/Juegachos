/**
 * URL de cada bandera SVG de `flag-icons` (formato 4x3). El glob solo resuelve
 * URLs: Vite copia los SVG como assets sueltos y el navegador baja cada uno
 * recien cuando se muestra o se precarga, no el paquete entero.
 */
const urls = import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byCode = new Map<string, string>();
for (const [path, url] of Object.entries(urls)) {
  const code = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
  byCode.set(code, url);
}

export function flagUrl(code: string): string {
  return byCode.get(code) ?? "";
}

const preloaded = new Set<string>();

/** Baja la bandera antes de que haga falta, para que no se coma el reloj. */
export function preloadFlag(code: string): void {
  if (preloaded.has(code)) return;
  preloaded.add(code);
  const img = new Image();
  img.decoding = "async";
  img.src = flagUrl(code);
}
