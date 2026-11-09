# Capture before/after with the corresponding release binaries, then compare.
# Works remain in place; output contains diagnostics/state only, never source JSON.
param(
    [ValidateSet('capture', 'compare')] [string] $Mode = 'capture',
    [string] $Output = 'dist/import-before',
    [string] $Before = 'dist/import-before',
    [string] $After = 'dist/import-after',
    [int] $Frames = 10
)
$ErrorActionPreference = 'Stop'
if ($Mode -eq 'capture') {
    New-Item -ItemType Directory -Force $Output | Out-Null
    $files = @(Get-ChildItem samples -Filter *.bcm)
    if (Test-Path dist/kitten4-corpus) { $files += @(Get-ChildItem dist/kitten4-corpus -Filter *.bcm) }
    $files += Get-ChildItem samples -Recurse -Filter *.bcmkn | Sort-Object Length -Descending | Select-Object -First 1
    $files += Get-ChildItem projects -Recurse -Filter *.bcmkn | Sort-Object Length -Descending | Select-Object -First 1
    $manifest = @()
    foreach ($file in $files) {
        $key = $file.BaseName
        if ($file.Extension -eq '.bcm') {
            & target/release/nekoc.exe coverage $file.FullName --frames $Frames | Set-Content -Encoding utf8 "$Output/$key.coverage.json"
            if ($LASTEXITCODE) { throw "coverage failed: $file" }
        }
        & target/release/bench-import.exe $file.FullName --snapshot --frames $Frames --out "$Output/$key.state.json" | Out-Null
        if ($LASTEXITCODE) { throw "snapshot failed: $file" }
        $manifest += $file.FullName
    }
    $manifest | ConvertTo-Json | Set-Content -Encoding utf8 "$Output/manifest.json"
    Write-Output "Captured $($files.Count) works, $Frames frames: $Output"
} else {
    $count = 0
    foreach ($file in Get-ChildItem $Before -Filter *.json | Where-Object { $_.Name -eq 'manifest.json' -or $_.Name.EndsWith('.state.json') -or $_.Name.EndsWith('.coverage.json') }) {
        if ($file.Name.EndsWith('.coverage.json')) {
            $a = @(Get-Content $file.FullName | ForEach-Object { $_ | ConvertFrom-Json })
            $b = @(Get-Content "$After/$($file.Name)" | ForEach-Object { $_ | ConvertFrom-Json })
        } else {
            $a = Get-Content -Raw $file.FullName | ConvertFrom-Json
            $b = Get-Content -Raw "$After/$($file.Name)" | ConvertFrom-Json
        }
        if ($file.Name.EndsWith('.state.json')) {
            foreach ($item in $a) { $item.PSObject.Properties.Remove('timings_ms') }
            foreach ($item in $b) { $item.PSObject.Properties.Remove('timings_ms') }
        }
        $left = ConvertTo-Json -InputObject $a -Depth 100 -Compress
        $right = ConvertTo-Json -InputObject $b -Depth 100 -Compress
        if ($left -cne $right) { throw "Mismatch: $($file.Name)" }
        $count++
    }
    Write-Output "PASS: $count JSON files identical (excluding timings_ms only)"
}
