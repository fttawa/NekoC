import wasm from "./dist/nodejs/nekoc_wasm.js";
import { api } from "./api.mjs";
export const { compile, check, createPlayer, importProject, validate } = api(wasm);
