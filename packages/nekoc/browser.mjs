import init, * as wasm from "./dist/web/nekoc_wasm.js";
import { api } from "./api.mjs";
await init();
export const { compile, check, createPlayer, importProject, validate } = api(wasm);
