// Test-only fault injection, loaded into the server via NODE_OPTIONS=--require.
// While a `fail-import-swap` file exists in the server's cwd, writing the inlay
// migration marker throws — a backup import that fails after its database
// was committed (the inlay folder swap comes after the commit).
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const original = fsp.writeFile;
fsp.writeFile = async (file, ...rest) => {
    if (typeof file === 'string' && file.endsWith('.migrated_to_fs') && fs.existsSync(path.join(process.cwd(), 'fail-import-swap'))) {
        throw new Error('injected inlay swap failure');
    }
    return original(file, ...rest);
};
