// Nombres de grupo en el formulario de alta: «Goblin x3» → 3 combatientes.
import { splitGroup } from "../src/initiative/tracker";
import { t } from "./helpers";

t("T-Rex2 es un solo combatiente", splitGroup("T-Rex2"), { base: "T-Rex2", count: null });
t("Goblin x3", splitGroup("Goblin x3"), { base: "Goblin", count: 3 });
t("Goblin ×3", splitGroup("Goblin ×3"), { base: "Goblin", count: 3 });
t("Goblin X 4", splitGroup("Goblin X 4"), { base: "Goblin", count: 4 });
t("Goblin x0 (el formulario avisa)", splitGroup("Goblin x0"), { base: "Goblin", count: 0 });
t("espacios alrededor", splitGroup("  Orco x2  "), { base: "Orco", count: 2 });
t("Goblinx3 sin espacio es un nombre", splitGroup("Goblinx3"), { base: "Goblinx3", count: null });
t("solo «x3» es un nombre", splitGroup("x3"), { base: "x3", count: null });
t("sin número", splitGroup("Rex"), { base: "Rex", count: null });
t("nombre con espacios", splitGroup("Hombre lobo x12"), { base: "Hombre lobo", count: 12 });
