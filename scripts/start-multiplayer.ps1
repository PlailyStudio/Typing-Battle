param(
    [string]$PagesUrl = 'https://plailystudio.github.io/Typing-Battle/',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$tunnelProcess = $null
$hasLock = $false
$runLock = New-Object System.Threading.Mutex($false, 'Local\TypingBattleMultiplayerLauncher')

function Find-Executable([string]$Name, [string[]]$Candidates) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    throw "$Name was not found. Install it and reopen this launcher."
}

function Test-Health([string]$Address) {
    try {
        $response = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 5
        return ($response.StatusCode -eq 200 -and $response.Content.Trim() -eq '{}')
    } catch { return $false }
}

try {
    try { $hasLock = $runLock.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
    if (-not $hasLock) { throw 'The multiplayer launcher is already running. Use its existing game link.' }

    $page = [uri]$PagesUrl
    if (-not $page.IsAbsoluteUri -or $page.Scheme -ne 'https' -or $page.Query -or $page.Fragment) {
        throw 'PagesUrl must be an HTTPS page URL without query parameters or a fragment.'
    }
    $docker = Find-Executable 'docker.exe' @(
        "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
        "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\resources\bin\docker.exe"
    )
    $cloudflared = Find-Executable 'cloudflared.exe' @(
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe"
    )
    $node = Find-Executable 'node.exe' @("$env:ProgramFiles\nodejs\node.exe")

    Write-Host 'Checking Docker Desktop...'
    & $docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw 'Open Docker Desktop, wait until the engine is running, then try again.' }
    & $docker compose version
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose is unavailable. Check the Docker Desktop installation.' }
    & $cloudflared --version
    if ($LASTEXITCODE -ne 0) { throw 'cloudflared could not start.' }
    & $node --version
    if ($LASTEXITCODE -ne 0) { throw 'Node.js could not start.' }
    if ($CheckOnly) {
        Write-Host 'Prerequisites OK. No server or tunnel was started.' -ForegroundColor Green
        exit 0
    }

    Write-Host '[1/4] Building the game server...'
    $runtimePath = Join-Path $projectRoot 'server\modules\index.js'
    $previousHash = if (Test-Path -LiteralPath $runtimePath) { (Get-FileHash -LiteralPath $runtimePath).Hash } else { '' }
    & $node scripts/build-server.js
    if ($LASTEXITCODE -ne 0) { throw 'Game server build failed.' }
    $runtimeChanged = $previousHash -ne (Get-FileHash -LiteralPath $runtimePath).Hash
    $existingServer = & $docker compose ps --status running -q nakama
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the existing game server.' }

    Write-Host '[2/4] Starting Docker services...'
    & $docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw 'Docker services failed to start. Check the messages above.' }
    if ($runtimeChanged -and $existingServer) {
        Write-Host 'Server code changed. Restarting Nakama to load it (active matches will end).'
        & $docker compose restart nakama
        if ($LASTEXITCODE -ne 0) { throw 'Nakama restart failed.' }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while (-not (Test-Health 'http://127.0.0.1:7350/healthcheck')) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Nakama did not become ready. Run: docker compose logs --tail 50 nakama' }
        Start-Sleep -Seconds 2
    }

    Write-Host '[3/4] Creating a temporary Cloudflare tunnel...'
    $logDirectory = Join-Path $projectRoot '.local\multiplayer'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $runId = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $logDirectory "$runId.stdout.log"
    $stderrPath = Join-Path $logDirectory "$runId.stderr.log"
    $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @('--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:7350') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $tunnelUrl = $null
    while (-not $tunnelUrl) {
        if ($tunnelProcess.HasExited) { throw "Tunnel exited. See: $stderrPath" }
        $log = (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue)
        $addressMatch = [regex]::Match([string]$log, 'https://[a-z0-9-]+\.trycloudflare\.com\b')
        if ($addressMatch.Success) { $tunnelUrl = $addressMatch.Value; break }
        if ([DateTime]::UtcNow -gt $deadline) { throw "No tunnel address received. See: $stderrPath" }
        Start-Sleep -Seconds 1
    }
    Write-Host "Tunnel: $tunnelUrl"
    Write-Host 'Waiting for the public game server to respond...'
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while (-not (Test-Health "$tunnelUrl/healthcheck")) {
        if ($tunnelProcess.HasExited) { throw "Tunnel exited. See: $stderrPath" }
        if ([DateTime]::UtcNow -gt $deadline) { throw "Public server did not become ready. See: $stderrPath" }
        Start-Sleep -Seconds 2
    }

    $gameUrl = $page.AbsoluteUri + '?server=' + ([uri]$tunnelUrl).Host
    Write-Host '[4/4] Opening the game...' -ForegroundColor Green
    Write-Host $gameUrl -ForegroundColor Cyan
    try { Set-Clipboard -Value $gameUrl; Write-Host 'Game link copied to clipboard.' }
    catch { Write-Host 'Clipboard unavailable. Copy the game link above.' }
    try { Start-Process $gameUrl }
    catch { Write-Host 'Open the game link above in your browser.' }
    Write-Host 'Keep this window open while playing. Create a room and share its invitation link.'
    Write-Host 'Press Q to stop this tunnel. Docker services will stay running.'
    while (-not $tunnelProcess.HasExited) {
        if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq 'Q') { break }
        Start-Sleep -Milliseconds 500
    }
    if ($tunnelProcess.HasExited) { throw "Tunnel stopped unexpectedly. See: $stderrPath" }
} catch {
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        Stop-Process -InputObject $tunnelProcess -ErrorAction SilentlyContinue
    }
    if ($hasLock) { $runLock.ReleaseMutex() }
    $runLock.Dispose()
}
