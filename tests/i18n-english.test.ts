import { formatTravelTime, formatTotal, parseHoursInput, PACES, formatDistance } from "../src/map/mapData";
import { T } from "../src/i18n";
import { setLocale, t } from "./helpers";

// Un idioma sin traducción (turco) debe mostrar inglés.
setLocale("tr");
t("turkish -> english", T("a", "b"), "b");
t("pace label", PACES.slow.label, "Slow");
t("travel", formatTravelTime(14, "normal"), "1 day and 6 h (14 h of travel, 8 h/day)");
t("travel 7.5", formatTravelTime(16, "fast"), "2 days and 1 h (16 h of travel, 7.5 h/day)");
t("total", formatTotal({ total: 12.5, unknown: 2, segments: 3 }, "km"), "12.5 km + 2 segments without distance");
t("none", formatTotal({ total: 0, unknown: 3, segments: 3 }, "km"), "no distances");
t("dist 1234", formatDistance(1234, "mi"), "1,234 mi");
t("hours", parseHoursInput("2 hours 15 minutes"), 2.25);
t("hrs", parseHoursInput("3hrs 30mins"), 3.5);
t("es still", parseHoursInput("6 horas 30 minutos"), 6.5);
setLocale("es-419");
t("es-419 -> es", PACES.fast.label, "Rápido");
t("es travel", formatTravelTime(14, "normal"), "1 día y 6 h (14 h de marcha, 8 h/día)");
