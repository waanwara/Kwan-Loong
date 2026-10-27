const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const candidates = [
    process.env.PYTHON_BIN,
    process.env.PYTHON,
    'python',
    'py',
    process.env.USERPROFILE
        ? path.join(
            process.env.USERPROFILE,
            '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
        )
        : null
].filter(Boolean);

let lastError;

for (const executable of candidates) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) {
        continue;
    }

    const result = spawnSync(
        executable,
        ['-m', 'unittest', 'discover', '-s', 'wildfire_analysis/tests'],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', stdio: 'inherit' }
    );

    if (result.error) {
        lastError = result.error;
        continue;
    }

    process.exit(result.status ?? 1);
}

console.error(
    'Python was not found. Install Python 3.10+ or set PYTHON_BIN to its executable path.'
);
if (lastError) {
    console.error(lastError.message);
}
process.exit(1);
