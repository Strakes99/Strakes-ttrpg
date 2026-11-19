import * as L from "leaflet";

/**
 * Leaflet no empieza un arrastre si Mayús está pulsada al hacer clic: la reserva para su zoom de caja,
 * que el plugin no usa (`boxZoom: false`). Para que Mayús+arrastrar mueva en línea recta (1.3.2) también
 * pulsando Mayús antes de hacer clic, `Draggable._onDown` recibe el evento con `shiftKey` en falso. Solo
 * usa de él lo que se copia aquí (Leaflet 1.9.4; revisarlo si se actualiza). Afecta solo a la copia de
 * Leaflet del plugin, que va dentro de main.js.
 */
interface DownEvent {
	type: string;
	/** El botón según Leaflet (`which`, obsoleto en el DOM pero el que comprueba Leaflet 1.9). */
	which?: number;
	button: number;
	clientX: number;
	clientY: number;
	shiftKey: boolean;
	touches?: TouchList;
}
type OnDown = (this: unknown, e: DownEvent) => void;
const proto = L.Draggable.prototype as unknown as { _onDown: OnDown; _strakesShiftPatch?: true };
if (!proto._strakesShiftPatch) {
	const original: OnDown = proto._onDown;
	proto._onDown = function (this: unknown, e: DownEvent): void {
		if (!e.shiftKey) {
			original.call(this, e);
			return;
		}
		original.call(this, { type: e.type, which: e.which, button: e.button, clientX: e.clientX, clientY: e.clientY, touches: e.touches, shiftKey: false });
	};
	proto._strakesShiftPatch = true;
}
