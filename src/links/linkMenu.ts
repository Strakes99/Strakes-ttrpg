import { Menu, MenuItem } from "obsidian";
import { T, TranslationKey } from "../i18n";
import { LinkKind } from "./linkTags";

/**
 * «Enlazar como» en los menús de clic derecho (pedido del desarrollador el 2026-11-26, opción A): una opción
 * con un **submenú** Conjuro / Criatura / Condición, que envuelve lo seleccionado en su marca. Va en el menú
 * del editor de notas (modo fuente y Live Preview; `main.ts`) y en el de los cuadros de texto del formulario
 * de statblocks (`form.ts`). En modo lectura no, porque ese texto no se puede editar.
 *
 * La API pública de Obsidian no tiene submenús: `MenuItem.setSubmenu()` es interna (la usa el propio
 * Obsidian, p. ej. en «Formato»). Va protegida: si un día falta, se añaden las tres opciones sueltas
 * («Enlazar como conjuro»…). Anotado en «Notes for reviewers» del README.
 */

/** En el orden pedido por el desarrollador. */
const KINDS: [LinkKind, TranslationKey][] = [
	["spell", "sbForm.linkSpell"],
	["creature", "sbForm.linkCreature"],
	["condition", "sbForm.linkCondition"],
];

type WithSubmenu = { setSubmenu?: () => Menu };

/** Añade «Enlazar como» a `menu`. Sin texto seleccionado (`enabled` falso) sale desactivada. */
export function addLinkAsItems(menu: Menu, enabled: boolean, onPick: (kind: LinkKind) => void): void {
	const canNest = typeof (MenuItem.prototype as unknown as WithSubmenu).setSubmenu === "function";
	if (canNest) {
		menu.addItem((item) => {
			item.setTitle(T("links.linkAs")).setIcon("link").setDisabled(!enabled);
			const sub = (item as unknown as WithSubmenu).setSubmenu?.();
			for (const [kind, label] of KINDS) sub?.addItem((i) => i.setTitle(T(label)).onClick(() => onPick(kind)));
		});
		return;
	}
	for (const [kind, label] of KINDS)
		menu.addItem((i) =>
			i
				.setTitle(T("links.linkAsKind", { kind: T(label) }))
				.setIcon("link")
				.setDisabled(!enabled)
				.onClick(() => onPick(kind)),
		);
}
