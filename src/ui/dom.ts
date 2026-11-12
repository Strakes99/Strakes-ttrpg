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
