# Strakes TTRPG

A toolkit for game masters who run tabletop RPGs from Obsidian:

- **Maps** — interactive image maps with markers, zones, layers, curved routes with distances and travel times, shortest and fastest paths, portals/stairs and a fog of war. Show them to your players, with what they can see under your control, and point or draw on them live.
- **Player screen** — a separate window for your second monitor or projector that shows notes, sections, selections, images and maps to your players.
- **Initiative tracker** — turns, rounds, hit points (including temporary HP), conditions with icons, and a portrait "cards" view for the player screen.

> The interface is available in **English** and **Spanish** and follows Obsidian's display language: Spanish when Obsidian is set to Spanish, English for every other language.

Desktop only (it uses a pop-out window for the player screen). Requires Obsidian 1.13.0 or later.

---

## Player screen

- **Open** it with the ribbon icon or the command *Open player screen*. It opens in its own window: drag it to your second monitor or projector.
- **Send content**: right-click a note, image or map → *Send to player screen*, or use the commands to send:
  - the active note, image or map;
  - the section under the cursor (the heading the cursor is in);
  - the selected text;
  - an image from your vault.
- **Note titles and live updates**: a whole note is shown with its title, like the inline title in Obsidian. Shown notes and sections update live while you edit them; if the heading of a shown section is renamed or deleted, the screen is cleared and you get a notice.
- **Clear** the screen with the eraser button (bottom-right, visible on hover) or the command *Clear player screen*.
- **Images** are scaled to fill the screen without being distorted or cropped.
- **Maps** fill the screen behind the initiative, showing only what you marked as visible to players (see *Maps on the player screen* below).
- **Fullscreen**: double-click the screen, or use the button in the bottom-right corner (visible on hover).

## Initiative tracker

Opens in the right sidebar.

- **Adding combatants**:
  - Initiative accepts a fixed number (`15`), a modifier (`+3` rolls 1d20+3), dice (`d20+2`, `2d6-1`) or nothing (1d20).
  - `Goblin x3` adds Goblin 1, 2 and 3, each with its own roll.
  - **Undo / redo** buttons revert or restore the last batch of added combatants.
  - The *PC/Ally* checkbox clears itself after each addition.
  - The *Hidden* checkbox (or the eye on each row) hides a combatant from the player screen.
  - *Duplicate* adds a copy with the next free number (Goblin 7), full HP, the same AC and initiative, and no conditions.
- **Turns**:
  - Next/previous turn and a round counter.
  - Defeated enemies (*Dead*) are skipped automatically; PCs and allies are never skipped.
- **Hit points**:
  - Heal (green **+**), damage (red **−**) and temporary HP (blue **T**). Damage is taken from temporary HP first.
  - Temporary HP doesn't stack: a new value replaces the old one and you get a notice.
  - HP can go below 0. HP is shown as `30(18)/45` (current (temporary) / maximum).
- **Conditions**:
  - **Built-in conditions** from the SRD 5.2, plus *Bloodied*, *Concentration* and *Dead*. Each has an icon. Hover shows the name, click shows the description, right-click removes it.
  - **Chained and cumulative**: conditions that apply others add them automatically (e.g. *Paralyzed* → *Incapacitated*). *Exhaustion* is cumulative and shows its level.
  - **Automatic**:
    - *Bloodied* is applied from HP (half or less).
    - *Dead* is applied to enemies at 0 HP, to PCs/allies at negative maximum HP, and to anyone at *Exhaustion* level 6.
    - PCs/allies at 0 HP become *Unconscious*; when healed above 0 they stay *Prone*.
    - *Concentration* reminds you of the Constitution save DC when damaged, and ends when the creature is incapacitated or drops to 0 HP.
  - **Editing**: built-in and custom conditions share the same editor: name, Markdown description, icon, color, applied conditions, levels and automations (apply at HP thresholds or at another condition's level, leave another condition when ending, end with other conditions or at 0 HP, save on damage, defeat the enemy, notify). Built-in conditions can be reset or hidden.
  - **Duration, caster and saves**: from a condition's description card you can set a duration (end or start of the target's or caster's next turn, a number of rounds, or while the caster keeps *Concentration*), who caused it, and a saving throw repeated at the end or start of each of the target's turns. Only *Next turn* advances durations; when a timed *Exhaustion* ends, it drops one level. Players don't see any of this.
- **On the player screen**: *Hidden*, *List* or *Cards*.
  - **List**: a corner box over the shown content, or the whole screen when nothing is shown. It flows into columns so nothing needs scrolling.
  - **Cards**: one card per combatant with name, square portrait, HP (optional) and condition icons. The current turn gets a glowing white frame. Card size, spacing and text size are configurable; cards shrink only when they don't fit the window.
  - Defeated enemies are struck through, and their HP and conditions are hidden from players (except *Dead*).
- **Portraits**:
  - Pick any image from your vault and frame it manually: drag to move, wheel or slider to zoom, and you can go beyond the image bounds.
  - The image search opens with the character's name already filled in (without its number).
  - The last portrait used for each name is remembered.
  - Without a portrait, a card shows the initial plus the number (`G1`, `G2`…).

## Maps (`.smap` files)

- **Create** a map: right-click an image → *Create map from this image*, or use the command *Create new map from an image*.
- **Markers**:
  - Optional link to a note or heading, stored as a wikilink. Left-click opens it; Ctrl+hover shows a preview (with the note title when the link is to a whole note).
  - **Portal / stairs**: right-click → *Use portal / stairs* moves the camera to another point or another marker (in embedded maps, right-click jumps directly). A portal's point is the center of its circle.
  - **AUTO name** (on by default): the marker takes its name from the link's alias, heading or note (or from a portal's destination) and follows renames.
  - **Icons**: emoji, letters, Lucide icons or your own SVG files. The icon picker lists your SVGs and, as one more entry of its folder dropdown, every Lucide icon Obsidian ships. SVGs go in the plugin's `icons/` folder, subfolders included; you can filter by folder and name and recolor the icon. Importing SVGs whose names already exist asks whether to replace them, skip them or save them under a new name.
  - **Anchored to route nodes**: drop a marker on a route node (or a node on a marker) and they're anchored: they move together, and measuring treats the marker as its node. One marker per node; right-click → *Unanchor from node*. While editing, the anchor button turns automatic anchoring off.
- **Visibility**: two toggles per marker, route, zone, layer and type (*Markers* / *Routes* / *Zones*) in the side panel: the **eye** for your own view and the **screen** for the players. They're independent, so tidying up your editor never changes what the players see. Everything starts hidden from players.
- **Search**: one box in the side panel filters layers, markers, routes and zones by name.
- **Labels**: a toolbar section turns labels on and off for you (eye) and for the players (screen), all at once or by type (right-click). You see marker and zone names and each segment's number and route; players see marker and zone names and each route's name once. Labels aren't saved.
- **Routes**:
  - Nodes, with curve points that shape a route without adding nodes.
  - Each segment can have a manual distance (for maps not drawn to scale) and a manual travel time, or estimate them from a calibrated scale.
  - Optional linked note with an AUTO name, like markers: with editing locked, clicking the route opens it; Ctrl+hover previews it.
- **Zones**: straight-sided polygons drawn vertex by vertex (rooms, districts, provinces…).
  - A name with AUTO, a linked note (click to open, Ctrl+hover to preview), fill and border colors, an area (typed, or calculated from the map scale), a layer and player visibility. The fill transparency is one setting for every zone.
  - While drawing or dragging, vertices snap to route nodes and to other zones' vertices, so neighbouring zones share their borders. Vertices that share a point move together, also when you drag a route node over them. The anchor button turns snapping and moving together off.
  - With editing unlocked, every zone's vertices can be dragged; select a zone to add vertices from the middle of its sides. Overlapping zones show a menu to choose which one you meant.
- **Fog of war** (turn it on in the map properties, or just pick the fog brush):
  - The whole map starts covered. A brush reveals or covers it; its size is in image pixels, so it covers the same area at any zoom. Right-click *Reveal* or *Cover* to do the whole map. Every stroke can be undone.
  - **Zones**: a zone's *Fog* checkbox keeps the whole zone covered and protected from the brush; unticked, the brush decides. A brush click on a zone toggles it. Turning the fog on ticks every zone.
  - You see it semi-transparent and can hide it with the cloud button (also in embedded maps); the players see it opaque, and markers, nodes and labels under it are hidden from them unless a setting shows them.
- **Measure**: a panel under the *Measure* button shows the path between two nodes along visible routes, with travel time at slow (2 mph, 9 h/day), normal (3 mph, 8 h/day) or fast (4 mph, 7.5 h/day) pace. When the **shortest** and the **fastest** path differ (manual segment times count first), both are listed and you can highlight either on the map. With a calibrated scale you can also measure a straight line.
- **Laser, pen and eraser**: the laser is a dot that follows your cursor, and dragging draws strokes that fade; the pen draws strokes that stay until Obsidian closes (with its own color); the eraser removes pen strokes. Players see all of it. With these tools, right-drag moves the map. Color, fade time and thickness are settings.
- **Distance unit**: one setting shows every map's distances and speeds in kilometers, miles, leagues, meters or feet, or in each map's own unit. New maps are created in that unit (kilometers with *Each map's own*). The conversion is only for display: values you enter stay in the map's own unit, so switching back and forth never changes them.
- **Zoom step**: a setting for how much each mouse wheel step zooms, in the editor and in embedded maps.
- **Undo / redo** in the map editor.
- **Embedding**:
  - `![[map.smap]]` shows an interactive map in a note.
  - `![[map.smap|300]]` sets the height and `![[map.smap|800x300]]` sets the width and height.
  - `![[map.smap#Marker name]]` centers the map on that marker.
  - The embed's toolbar has layers, labels (click for all, right-click by type), fit, a button to hide the fog, a **lock** (no zoom or dragging, so the wheel scrolls the note) and a button to open the map. A setting locks every embedded map and hides the lock.
  - Zones and routes with a note open it on click and preview it on Ctrl+hover; routes show their name on hover.
- **Renaming**: renaming or moving a linked note or a map image updates the maps automatically.

### Maps on the player screen

- Send a map from the editor's toolbar (screen-with-arrow button) or right-click a `.smap` → *Send to player screen*.
- The players see the map full-screen, behind the initiative, with only the markers, routes, zones and layers marked as visible to them, under the fog of war. They can't move it: you choose what they see.
- **Frame**: while the map is on the player screen, a dashed frame in your editor shows what *Send* would send (it follows the shape of the players' window), and a solid rectangle shows what they see now. Press the button again to fly their view to your frame.
- **Live** (cast button): the players follow your view as you move. Opening side panels or resizing Obsidian never changes what they see.
- What the players can't see is shown semi-transparent in your editor (the transparency is a setting).

## Data and files

- **Maps** are plain JSON files with the `.smap` extension, stored in your vault.
- **Settings, the current combat, custom conditions and remembered portraits** are stored in the plugin's `data.json`.
- **Not saved**: labels, laser and pen drawings, and the live view only last while Obsidian is open.
- **Custom SVG icons** live in `<vault>/.obsidian/plugins/strakes-ttrpg/icons/`. Plugin updates don't touch this folder, but uninstalling the plugin deletes it.
- **SVG sanitizing**: every SVG is cleaned before it is displayed. Scripts, event handlers, HTML elements, link-changing animations, `javascript:` links and external resources (including those referenced from CSS) are removed.

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
npm test        # run the tests in tests/
```

Source code is in `src/`. The build outputs `main.js` and `styles.css`, which Obsidian loads together with `manifest.json`.
