import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type StrakesTTRPG from "../main";
import { createLinkEl } from "./linkify";
import { codeRanges, LINK_TAG_RE, LinkTag, parseLinkTag } from "./linkTags";

/**
 * Enlaces en Live Preview (1.4, paso 6): cada marca `{@condition …}`, `{@creature …}` o `{@spell …}` se ve
 * como su enlace, salvo con el cursor o la selección encima (entonces se ve la marca, para editarla), en el
 * código (bloques y en línea) y en las propiedades. En modo fuente no se toca nada.
 */
class LinkWidget extends WidgetType {
	constructor(
		private plugin: StrakesTTRPG,
		private tag: LinkTag,
	) {
		super();
	}

	eq(other: LinkWidget): boolean {
		return other.tag.raw === this.tag.raw;
	}

	toDOM(view: EditorView): HTMLElement {
		return createLinkEl(this.plugin, this.tag, view.dom.doc);
	}

	/** El enlace atiende sus propios clics (no mueven el cursor). */
	ignoreEvent(): boolean {
		return true;
	}
}

function build(plugin: StrakesTTRPG, view: EditorView): DecorationSet {
	if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
	const doc = view.state.doc;
	const text = doc.toString();
	const code = codeRanges(text);
	const selections = view.state.selection.ranges;
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		const slice = text.slice(from, to);
		for (const m of slice.matchAll(LINK_TAG_RE)) {
			const start = from + (m.index ?? 0);
			const end = start + m[0].length;
			if (code.some(([a, b]) => start < b && end > a)) continue;
			if (selections.some((r) => r.from <= end && r.to >= start)) continue;
			builder.add(start, end, Decoration.replace({ widget: new LinkWidget(plugin, parseLinkTag(m[0], m[1], m[2])) }));
		}
	}
	return builder.finish();
}

export function linkLivePreview(plugin: StrakesTTRPG) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(plugin, view);
			}
			update(u: ViewUpdate): void {
				const modeChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
				if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged) this.decorations = build(plugin, u.view);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
