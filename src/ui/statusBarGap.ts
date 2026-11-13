import { Component } from "obsidian";
import { resizeObserverFor } from "./dom";

/**
 * La barra de estado de Obsidian flota sobre la esquina inferior derecha de la ventana
 * y tapa lo que haya debajo. Esto mide si realmente se superpone con `el` y, solo en
 * ese caso, expone la altura solapada en la variable CSS `--strakes-statusbar-gap`.
 * Si la vista está en la mitad superior de la barra lateral (o en otra ventana), vale 0.
 */
export function watchStatusBarGap(owner: Component, el: HTMLElement): () => void {
	let frame = 0;
	const update = () => {
		frame = 0;
		const bar = el.doc.querySelector<HTMLElement>(".status-bar");
		let gap = 0;
		if (bar && el.isConnected) {
			const b = bar.getBoundingClientRect();
			const c = el.getBoundingClientRect();
			const visible = b.width > 0 && b.height > 0 && c.width > 0 && c.height > 0;
			const overlapX = Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0;
			const overlapY = c.bottom - b.top;
			if (visible && overlapX && overlapY > 0 && c.top < b.top) gap = Math.ceil(overlapY);
		}
		el.setCssProps({ "--strakes-statusbar-gap": `${gap}px` });
	};
	const schedule = () => {
		if (!frame) frame = el.win.requestAnimationFrame(update);
	};

	// El padding no cambia el tamaño del rectángulo de `el`, así que no hay bucle.
	const ro = resizeObserverFor(el, schedule);
	ro.observe(el);
	const bar = el.doc.querySelector<HTMLElement>(".status-bar");
	if (bar) ro.observe(bar); // su ancho cambia con el texto (palabras, enlaces…)
	owner.register(() => {
		ro.disconnect();
		if (frame) el.win.cancelAnimationFrame(frame);
	});
	schedule();
	return schedule;
}
