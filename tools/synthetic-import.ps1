# Self-authored published K4 workload, generated only under ignored dist/.
param([int] $Scripts = 200, [int] $Length = 24, [string] $Out = 'dist/import-synthetic.bcm')
$ErrorActionPreference = 'Stop'
$roots = [ordered]@{}
for ($i = 0; $i -lt $Scripts; $i++) {
    $next = $null
    for ($j = $Length - 1; $j -ge 0; $j--) {
        $next = [ordered]@{ type = 'self_set_position'; id = "s$i-b$j"; params = @{ coordinary = 'x'; value = @{ type = 'math_number'; params = @{ NUM = '1' } } }; next_block = $next }
    }
    $roots["s$i"] = @{ type = 'start_on_click'; id = "s$i"; next_block = $next }
}
$source = @{
    version = 25; work_type = 'KITTEN'; project_name = 'NekoC synthetic import benchmark'
    size = @{ width = 640; height = 360 }
    theatre = @{
        current_scene = 'scene'; scenes_order = @('scene')
        scenes = @{ scene = @{ id = 'scene'; actors = @('actor') } }
        actors = @{ actor = @{ id = 'actor'; name = 'Synthetic'; x = 0; y = 0 } }
    }
    compile_result = @(@{ id = 'actor'; compiled_block_map = $roots })
}
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$source | ConvertTo-Json -Depth 100 -Compress | Set-Content -Encoding utf8NoBOM $Out
Get-Item $Out | Select-Object FullName,Length
