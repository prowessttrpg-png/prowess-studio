// Registers ./extensionless-resolve.mjs (developer scripts only): `node --import ./scripts/dev/register-extensionless.mjs …`
import { register } from "node:module";
register("./extensionless-resolve.mjs", import.meta.url);
