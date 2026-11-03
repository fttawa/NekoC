$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    node tools/build-extension.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension build failed' }
    if (!(Test-Path 'target/release/web.exe')) { throw 'Run cargo build --release --bin web first' }
    $bundle = 'dist/neko-pickcat-windows'
    New-Item -ItemType Directory -Force "$bundle/extension" | Out-Null
    Copy-Item 'dist/pickcat-rust/*' "$bundle/extension" -Recurse -Force
    Copy-Item 'target/release/web.exe' "$bundle/web.exe" -Force
    Copy-Item 'start-rust-backend.cmd' "$bundle/start-rust-backend.cmd" -Force
    Copy-Item 'docs/pickcat-extension.md' "$bundle/README.md" -Force
    foreach ($doc in @('web-compatibility.md', 'web-compatibility-audit.json', 'web-compatibility-before.json', 'web-broadcast-verification.json', 'web-player-verification.json', 'starhold-web-verification.json')) {
        Copy-Item "docs/$doc" "$bundle/$doc" -Force
    }
    Compress-Archive -Path "$bundle/*" -DestinationPath 'dist/neko-pickcat-windows.zip' -Force
    Compress-Archive -Path 'dist/pickcat-rust/*' -DestinationPath 'dist/pickcat-rust-extension.zip' -Force
    Get-Item 'dist/neko-pickcat-windows.zip','dist/pickcat-rust-extension.zip' | Select-Object FullName,Length
} finally { Pop-Location }
