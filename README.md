# Strakes TTRPG

A toolkit for game masters who run tabletop RPGs from Obsidian:

- **Maps** — interactive image maps with markers, layers, curved routes with distances and travel times, and portals/stairs.
- **Player screen** — a separate window for your second monitor or projector that shows notes, sections, selections and images to your players.
- **Initiative tracker** — turns, rounds, hit points (including temporary HP), conditions with icons, and a portrait "cards" view for the player screen.

> The plugin's user interface is currently in **Spanish**. Built-in condition names and descriptions are available in Spanish and English and follow Obsidian's display language. A full English UI is planned.

Desktop only (it uses a pop-out window for the player screen).

---

## Player screen

- **Open** it with the ribbon icon or the command *Abrir pantalla de jugadores* (open player screen). It opens in its own window: drag it to your second monitor or projector.
- **Send content**: right-click a note or image → *Enviar a la pantalla de jugadores* (send to player screen), or use the commands to send:
  - the active note or image;
  - the section under the cursor (the heading the cursor is in);
  - the selected text;
  - an image from your vault.
- **Note titles**: a whole note is shown with its title, like the inline title in Obsidian. Shown notes update live while you edit them.
- **Images** are scaled to fill the screen without being distorted or cropped.
- **Fullscreen**: double-click the screen, or use the button in the bottom-right corner (visible on hover).

## Initiative tracker

Opens in the right sidebar.

- **Adding combatants**:
  - Initiative accepts a fixed number (`15`), a modifier (`+3` rolls 1d20+3), dice (`d20+2`, `2d6-1`) or nothing (1d20).
  - `Goblin x3` adds Goblin 1, 2 and 3, each with its own roll.
  - **Undo / redo** buttons revert or restore the last batch of added combatants.
  - The *PJ/Aliado* (PC/ally) checkbox clears itself after each addition.
- **Turns**:
  - Next/previous turn and a round counter.
  - Defeated enemies (0 HP or less) are skipped automatically; PCs and allies are never skipped.
- **Hit points**:
  - Heal (green **+**), damage (red **−**) and temporary HP (blue **T**). Damage is taken from temporary HP first.
  - Temporary HP doesn't stack: a new value replaces the old one and you get a notice.
  - HP can go below 0. HP is shown as `30(18)/45` (current (temporary) / maximum).
- **Conditions**:
  - **Built-in conditions** from the SRD 5.2, plus *Bloodied*, *Concentration* and *Dead*. Each has an icon. Hover shows the name, click shows the description, right-click removes it.
  - **Chained and cumulative**: conditions that apply others add them automatically (e.g. *Paralyzed* → *Incapacitated*). *Exhaustion* is cumulative and shows its level.
  - **Automatic**:
    - *Bloodied* is applied from HP (half or less).
    - *Dead* is applied to enemies at 0 HP, and to PCs/allies at negative maximum HP.
    - PCs/allies at 0 HP become *Unconscious*; when healed above 0 they stay *Prone*.
    - *Concentration* reminds you of the Constitution save DC when damaged, and ends when the creature is incapacitated or drops to 0 HP.
  - **Editing**: built-in conditions can be fully edited for house rules (name, description, icon, color, applied conditions, levels) and reset. You can also create custom conditions with your own icon and color.
- **On the player screen**: *Hidden*, *List* or *Cards*.
  - **List**: a corner box over the shown content, or the whole screen when nothing is shown. It flows into columns so nothing needs scrolling.
  - **Cards**: one card per combatant with name, square portrait, HP (optional) and condition icons. The current turn gets a glowing white frame. Card size, spacing and text size are configurable; cards shrink only when they don't fit the window.
  - Defeated enemies are struck through, and their HP and conditions are hidden from players (except *Dead*).
- **Portraits**:
  - Pick any image from your vault and frame it manually: drag to move, wheel or slider to zoom, and you can go beyond the image bounds.
  - The last portrait used for each name is remembered.
  - Without a portrait, a card shows the initial plus the number (`G1`, `G2`…).

## Maps (`.smap` files)

- **Create** a map: right-click an image → *Crear mapa con esta imagen* (create map from this image), or use the command *Crear mapa nuevo desde una imagen*.
- **Markers**:
  - Optional link to a note or heading, stored as a wikilink. Left-click opens it; Ctrl+hover shows a preview with the note title.
  - **Portal / stairs**: right-click moves the camera to another point or another marker.
  - Icons can be emoji, letters, Lucide icon names, or your own SVG files. SVGs go in the plugin's `icons/` folder, subfolders included; you can filter by folder and name and recolor the icon.
- **Visibility**: fixed *Markers* / *Routes* toggles, plus your own layers. Each marker or route can be in one layer or none.
- **Routes**:
  - Nodes, with curve points that shape a route without adding nodes.
  - Each segment can have a manual distance (for maps not drawn to scale) and a manual travel time, or estimate them from a calibrated scale.
  - Segment labels show the segment number and route name.
- **Measure**: shortest path between two nodes along visible routes, with travel time at slow (2 mph, 9 h/day), normal (3 mph, 8 h/day) or fast (4 mph, 7.5 h/day) pace.
- **Undo / redo** in the map editor.
- **Embedding**:
  - `![[map.smap]]` shows an interactive map in a note.
  - `![[map.smap|300]]` sets the height and `![[map.smap|800x300]]` sets the width and height.
  - `![[map.smap#Marker name]]` centers the map on that marker.
- **Renaming**: renaming or moving a linked note or a map image updates the maps automatically.

## Data and files

- **Maps** are plain JSON files with the `.smap` extension, stored in your vault.
- **Settings, the current combat, custom conditions and remembered portraits** are stored in the plugin's `data.json`.
- **Custom SVG icons** live in `<vault>/.obsidian/plugins/strakes-ttrpg/icons/`. Plugin updates don't touch this folder, but uninstalling the plugin deletes it.
- **SVG sanitizing**: every SVG is cleaned when loaded. Scripts, event handlers, `javascript:` links and external resources are removed.

## Notes for reviewers

- **Map embeds** use `app.embedRegistry.registerExtension` so that `![[file.smap]]` renders an interactive map. This is the same internal mechanism Obsidian uses for Canvas and Bases embeds; there is no public API for custom embeds yet. Registration is guarded: if the API is missing or changes, the plugin keeps working and only map embeds are unavailable.
- **The player screen** is a regular view opened with `workspace.openPopoutLeaf()`.
- **Network and telemetry**: none.

## Attribution

This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

The Spanish translations of the SRD 5.2 condition texts are a derivative of that material and are shared under the same license.

Bundled library: [Leaflet](https://leafletjs.com/) (BSD 2-Clause License).

## License

The plugin's code is released under the [MIT License](LICENSE). SRD 5.2 material is licensed under CC-BY-4.0, as stated above.

## Development

```bash
npm install
npm run dev     # rebuild on save
npm run build   # type-check + production build
```

Source code is in `src/`. The build outputs `main.js` and `styles.css`, which Obsidian loads together with `manifest.json`.
