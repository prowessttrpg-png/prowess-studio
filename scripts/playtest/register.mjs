// Registers ./ts-hooks.mjs (M6-WO12 playtest preparation only).
import { register } from "node:module";
register("./ts-hooks.mjs", import.meta.url);
