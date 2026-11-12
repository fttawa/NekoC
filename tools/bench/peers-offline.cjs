// Preload for the reviewed, repository-owned synthetic inputs only. Never allow
// the converter or VM to hydrate remote assets or load remote extensions.
let attempts = 0;
const deny = () => { attempts++; throw new Error('peerbench: external network disabled'); };
// The converter catches asset-fetch errors. Do not silently accept a project
// with substituted blank assets after a denied attempt.
process.on('beforeExit', () => {
  if (attempts) {
    console.error(`peerbench: ${attempts} denied network attempts`);
    process.exitCode = 1;
  }
});
globalThis.fetch = deny;
globalThis.WebSocket = class { constructor () { deny(); } };
for (const name of ['node:http', 'node:https']) {
  const api = require(name);
  api.request = deny;
  api.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
