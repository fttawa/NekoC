# End-to-end localhost startup + /play's import-player request, no browser assets.
param(
    [Parameter(Mandatory)] [string] $InputFile,
    [int] $Port = 4198,
    [string] $Executable = 'target/release/web.exe',
    [int] $TimeoutSeconds = 900
)
$ErrorActionPreference = 'Stop'
$clock = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process $Executable -ArgumentList @("`"$InputFile`"", '--port', $Port) -PassThru -NoNewWindow
try {
    $handler = [Net.Http.SocketsHttpHandler]::new()
    $handler.ConnectTimeout = [TimeSpan]::FromMilliseconds(100)
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $base = "http://127.0.0.1:$Port"
    do {
        if ($clock.Elapsed.TotalSeconds -gt $TimeoutSeconds) { throw 'server startup timed out' }
        if ($process.HasExited) { throw 'server exited during startup' }
        try { $response = $client.GetAsync("$base/api/health").GetAwaiter().GetResult() } catch { $response = $null }
        if (-not $response) { Start-Sleep -Milliseconds 20 }
    } until ($response -and $response.IsSuccessStatusCode)
    $startup = $clock.Elapsed.TotalMilliseconds
    $project = $client.GetStringAsync("$base/api/project").GetAwaiter().GetResult()
    $clock.Restart()
    $content = [Net.Http.StringContent]::new($project, [Text.Encoding]::UTF8, 'application/json')
    $response = $client.PostAsync("$base/api/import-player", $content).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw $body }
    $hit = $clock.Elapsed.TotalMilliseconds
    $ready = ($body | ConvertFrom-Json).fast_runtime_ready
    [pscustomobject]@{ file = $InputFile; startup_ms = $startup; cached_play_import_ms = $hit; fast_runtime_ready = $ready } | ConvertTo-Json
} finally {
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    if ($content) { $content.Dispose() }
    if ($client) { $client.Dispose() }
}
