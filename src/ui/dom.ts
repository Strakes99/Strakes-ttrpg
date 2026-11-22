/**
 * ResizeObserver de la ventana a la que pertenece `el`. Un observador creado en la
 * ventana principal no se entera de los cambios de tamaño de elementos que viven en
 * otra ventana (p. ej. la pantalla de jugadores), así que hay que usar el de esa ventana.
 */
export function resizeObserverFor(el: HTMLElement, callback: ResizeObserverCallback): ResizeObserver {
	const win = el.win as unknown as { ResizeObserver?: typeof ResizeObserver };
	const RO = win.ResizeObserver ?? ResizeObserver;
	return new RO(callback);
}

/**
 * Número decimal escrito por el usuario: acepta coma o punto («1,5» y «1.5»), con signo. NaN si no es
 * un número (vacío incluido). Los campos lo muestran siempre con punto.
 */
export function parseDecimal(text: string): number {
	const t = text.trim().replace(",", ".");
	return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

/**
 * Campo para decimales: de texto (no `type="number"`, que en un navegador en español rechaza la coma
 * antes de que llegue al código), con el teclado numérico en pantallas táctiles. Se lee con `parseDecimal`.
 */
export function decimalInput(input: HTMLInputElement): void {
	input.type = "text";
	input.inputMode = "decimal";
}
