import { formatTravelTime } from "../src/map/mapData";
import { t } from "./helpers";
// Paso normal: 8 h/día.
t("15,999 h → 2 días (antes «1 día y 8 h»)", formatTravelTime(15.9999, "normal"), "2 días (16 h de marcha, 8 h/día)");
t("16 h → 2 días", formatTravelTime(16, "normal"), "2 días (16 h de marcha, 8 h/día)");
t("14 h → 1 día y 6 h", formatTravelTime(14, "normal"), "1 día y 6 h (14 h de marcha, 8 h/día)");
t("7,9999 h → 1 día", formatTravelTime(7.9999, "normal"), "1 día (8 h de marcha, 8 h/día)");
t("6 h 30 min → sin días", formatTravelTime(6.5, "normal"), "6 h 30 min");
t("8 h 0,4 min → 1 día", formatTravelTime(8 + 0.4 / 60, "normal"), "1 día (8 h de marcha, 8 h/día)");
t("8 h 1 min → 1 día y 1 min", formatTravelTime(8 + 1 / 60, "normal"), "1 día y 1 min (8 h 1 min de marcha, 8 h/día)");
// Paso rápido: 7,5 h/día.
t("rápido 15 h → 2 días", formatTravelTime(15, "fast"), "2 días (15 h de marcha, 7,5 h/día)");
t("rápido 16 h → 2 días y 1 h", formatTravelTime(16, "fast"), "2 días y 1 h (16 h de marcha, 7,5 h/día)");
// Paso lento: 9 h/día.
t("lento 26,9999 h → 3 días", formatTravelTime(26.9999, "slow"), "3 días (27 h de marcha, 9 h/día)");
