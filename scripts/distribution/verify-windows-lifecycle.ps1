[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Run')] [string] $PreviousArtifact,
    [Parameter(Mandatory)] [string] $CandidateArtifact,
    [Parameter(Mandatory, ParameterSetName = 'Run')] [string] $PlaytestBackup,
    [Parameter(Mandatory)] [string] $EvidenceDirectory,
    [Parameter(Mandatory, ParameterSetName = 'Reboot')] [switch] $AfterReboot
)

$ErrorActionPreference = 'Stop'
$artifact = (Get-Item -LiteralPath $CandidateArtifact).FullName
$local = [Environment]::GetFolderPath('LocalApplicationData')
$install = Join-Path $local 'Prowess Studio'
$data = Join-Path $local 'Prowess Studio Data'
$registry = 'HKCU:\Software\Prowess Studio'
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
$summary = Join-Path $evidence 'lifecycle-evidence.json'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutFile = Join-Path $desktop 'Prowess Studio.lnk'
$verifier = Join-Path $artifact 'installed-lifecycle.mjs'
$targetProcessId = $PID
$os = & (Join-Path $artifact 'windows-proof-environment.ps1') | ConvertFrom-Json
if ($os.nativeMachine -ne 0x8664 -or $os.processMachine -ne 0 -or $os.productType -ne 1 -or
    $os.caption -notmatch 'Windows 11' -or $os.isElevated -or $os.isAdministrator -or $os.elevationType -ne 1) {
    throw 'Use a standard user on native Windows 11 x64.'
}
$boot = (Get-CimInstance -ClassName Win32_OperatingSystem -Property LastBootUpTime).LastBootUpTime.ToUniversalTime().ToString('o')

function Read-Json([string] $File) {
    Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Assert-Digest([string] $File, [string] $Digest) {
    if ($Digest -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Digest) {
        throw "Unexpected SHA-256 for $([IO.Path]::GetFileName($File))."
    }
}
function Package([string] $Directory, [string] $Version) {
    $folder = (Get-Item -LiteralPath $Directory).FullName
    $identity = Read-Json (Join-Path $folder 'installer-build.json')
    $metadataFile = Join-Path $folder 'prototype.json'
    $manifest = Read-Json $metadataFile
    if ($manifest.appVersion -cne $Version -or $manifest.packageSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $identity.source.commit -cne $manifest.build.commit -or $identity.source.tree -cne $manifest.build.tree -or
        $manifest.build.commit -cnotmatch '^[a-f0-9]{40}$' -or $manifest.build.tree -cnotmatch '^[a-f0-9]{40}$' -or
        $manifest.build.platform -cne 'win32' -or $manifest.build.architecture -cne 'x64') {
        throw "Invalid Windows package identity for $Version."
    }
    $label = "$Version-" + $manifest.packageSha256.Substring(0, 12)
    if ($identity.packageId -cne $label -or $identity.installer -cne "ProwessStudio-$label-Windows-x64.exe") {
        throw "Unexpected installer filename for $Version."
    }
    $exe = Join-Path $folder $identity.installer
    Assert-Digest $exe $identity.installerSha256
    Assert-Digest $metadataFile $identity.manifestSha256
    if ((Get-Item -LiteralPath $exe).Length -ne $identity.installerBytes) { throw 'Installer size differs.' }
    $versionDir = Join-Path (Join-Path $install 'versions') $label
    @{
        version = $Version; identity = $identity; manifest = $manifest; installer = $exe
        launcher = (Join-Path $versionDir 'ProwessStudio.exe')
        payload = (Join-Path $versionDir 'payload')
        node = (Join-Path $versionDir 'payload\runtime\node.exe')
    }
}
function Wait-Until([scriptblock] $Condition, [string] $Description, [int] $Seconds = 45) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for $Description."
}
function Install-Artifact($Package, [bool] $Refuse = $false) {
    $setup = Start-Process -FilePath $Package.installer -ArgumentList '/S' -PassThru
    if (-not $setup.WaitForExit(300000)) { throw 'Setup did not finish within five minutes.' }
    if ($Refuse) {
        if ($setup.ExitCode -eq 0) { throw 'Setup accepted an unsupported downgrade.' }
        return
    }
    if ($setup.ExitCode -ne 0) { throw "Setup exited with code $($setup.ExitCode)." }
    Assert-Digest $Package.launcher $Package.identity.launcherSha256
    Assert-Digest (Join-Path $Package.payload 'prototype.json') $Package.identity.manifestSha256
    Assert-Digest $Package.node $Package.manifest.nodeSha256
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutFile)
    if (-not (Test-Path -LiteralPath $shortcutFile -PathType Leaf) -or $shortcut.TargetPath -ne $Package.launcher) {
        throw 'The desktop shortcut does not target the tested launcher.'
    }
}
function Start-Launcher($Package) {
    $script:currentPackage = $Package
    $script:launch = Start-Process -FilePath $Package.launcher -WorkingDirectory (Split-Path -Parent $Package.launcher) -PassThru
}
function Close-Launcher {
    if (-not $script:launch -or $script:launch.HasExited) { return }
    $quit = Start-Process -FilePath $script:currentPackage.launcher -ArgumentList '--quit' -PassThru
    if (-not $quit.WaitForExit(40000) -or $quit.ExitCode -ne 0 -or
        -not $script:launch.WaitForExit(40000) -or $script:launch.ExitCode -ne 0) {
        throw 'The owned launcher did not stop cleanly.'
    }
}
function Run-Probe($Package, [string] $Phase, [string] $InputFile = '') {
    & $Package.node $verifier $Phase $data $Package.payload $evidence $InputFile
    if ($LASTEXITCODE -ne 0) { throw "Installed lifecycle probe failed during $Phase." }
}
function State-Digest {
    (Get-FileHash -LiteralPath (Join-Path $data 'workspace.json') -Algorithm SHA256).Hash
}
function Move-TestEngine($Package, [string] $Source, [string] $Destination) {
    $move = "const fs = require('node:fs'); const path = require('node:path'); fs.renameSync(...process.argv.slice(1).map(path.toNamespacedPath));"
    & $Package.node -e $move $Source $Destination
    if ($LASTEXITCODE -ne 0) { throw 'Could not move the migration engine for the disposable test.' }
}
function Listen-Port([int] $Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); $listener }
    catch [Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -ne [Net.Sockets.SocketError]::AddressAlreadyInUse) { throw }
    }
}
function Assert-Port([int] $Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $client.Connect([Net.IPAddress]::Loopback, $Port) }
    finally { $client.Dispose() }
}

$new = Package $artifact '0.1.1'
$script:launch = $null
$script:currentPackage = $null
if ($AfterReboot) {
    $prior = Read-Json $summary
    if ($prior.result -cne 'passed' -or $prior.candidate.installerSha256 -cne $new.identity.installerSha256 -or $prior.bootUtc -eq $boot) {
        throw 'Use the passing evidence directory after restarting Windows, with the same candidate installer.'
    }
    Assert-Digest $new.launcher $new.identity.launcherSha256
    Assert-Digest (Join-Path $new.payload 'prototype.json') $new.identity.manifestSha256
    Assert-Digest $new.node $new.manifest.nodeSha256
    try {
        Start-Launcher $new
        Run-Probe $new 'after-reboot'
        Close-Launcher
        [ordered]@{ result = 'passed'; previousBootUtc = $prior.bootUtc; bootUtc = $boot; installerSha256 = $new.identity.installerSha256 } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'windows-reboot.json') -Encoding UTF8
    } finally { Close-Launcher }
    Write-Host "Reboot evidence: $evidence"
    return
}

if ((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $data) -or (Test-Path $registry)) {
    throw 'Use a clean, disposable Windows standard account. The existing Prowess workspace is outside this test.'
}
$old = Package $PreviousArtifact '0.1.0'
Assert-Digest $old.installer '982bed23fe02dc60048dea4f53955ba24c29aa366ec4df4134dfac1ecbd68ad9'
$backup = (Get-Item -LiteralPath $PlaytestBackup).FullName
if (Test-Path -LiteralPath $evidence) { throw 'Use a new evidence directory.' }
New-Item -ItemType Directory -Path $evidence | Out-Null
$status = [ordered]@{
    format = 1; result = 'failed'; bootUtc = $boot; host = $os
    previous = $old.identity; candidate = $new.identity; tests = @()
}
$pathBefore = $env:Path
$listeners = @()
try {
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($cmd in @('node.exe', 'git.exe', 'pnpm.cmd', 'postgres.exe')) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) { throw "Unexpected runtime on PATH: $cmd." }
    }
    $status.phase = 'install previous and check playtest backup'
    Install-Artifact $old
    Run-Probe $old 'check-backup' $backup
    $status.phase = 'restore into a second installation with occupied default ports'
    $ports = @(3000, 3100, 5432)
    $listeners = @($ports | ForEach-Object { Listen-Port $_ })
    Start-Launcher $old
    Run-Probe $old 'baseline' $backup
    foreach ($port in $ports) { Assert-Port $port }
    $status.occupiedPorts = $ports
    $status.tests += @('W02 empty first run', 'W05 occupied default ports', 'W07 restore across installations with independent SQL fingerprint',
        'W08 reject corrupt, incompatible and executable-object-bearing backups and roll back invalid staging', 'W12 authenticated loopback checks')
    $status.phase = 'invoke the launcher again while Studio is running'
    $control = Join-Path $data 'control.json'
    $controlDigest = (Get-FileHash -LiteralPath $control -Algorithm SHA256).Hash
    $stateDigest = State-Digest
    $duplicate = Start-Process -FilePath $old.launcher -PassThru
    if (-not $duplicate.WaitForExit(30000) -or $duplicate.ExitCode -ne 0 -or $script:launch.HasExited) {
        throw 'The second launcher did not reuse the existing session.'
    }
    if ((Get-FileHash -LiteralPath $control -Algorithm SHA256).Hash -ne $controlDigest -or (State-Digest) -ne $stateDigest) {
        throw 'The duplicate launch replaced the controller or workspace.'
    }
    Run-Probe $old 'duplicate'
    $status.tests += 'W04 duplicate launch preserves the running controller and workspace'
    $status.phase = 'stop the owned launcher unexpectedly'
    $script:launch.Kill()
    if (-not $script:launch.WaitForExit(30000)) { throw 'The owned launcher did not exit.' }
    Start-Launcher $old
    Run-Probe $old 'after-launcher-crash'
    Close-Launcher
    $status.tests += 'W06 launcher crash recovers without changing the Character'
    foreach ($listener in $listeners) { $listener.Stop() }
    $listeners = @()

    $status.phase = 'inject upgrade failure then recover with previous launcher'
    $beforeUpgradeHash = State-Digest
    $beforeUpgrade = Read-Json (Join-Path $data 'workspace.json')
    Install-Artifact $new
    $engine = Join-Path $new.payload $new.manifest.schemaEngine
    $held = $engine + '.lifecycle-test'
    Move-TestEngine $new $engine $held
    try {
        Start-Launcher $new
        Run-Probe $new 'failure'
        Close-Launcher
    } finally {
        try { Close-Launcher }
        finally { Move-TestEngine $new $held $engine }
    }
    if ((State-Digest) -ne $beforeUpgradeHash) { throw 'Failed upgrade changed the workspace identity.' }
    Start-Launcher $old
    Run-Probe $old 'still-old'
    Close-Launcher
    $status.tests += 'W10 staged migration failure preserves usable previous app and data'

    $status.phase = 'upgrade and reject the previous installer'
    Start-Launcher $new
    Run-Probe $new 'upgrade'
    Close-Launcher
    $afterUpgrade = Read-Json (Join-Path $data 'workspace.json')
    if ($afterUpgrade.active -eq $beforeUpgrade.active -or $afterUpgrade.id -ne $beforeUpgrade.id) {
        throw 'Upgrade did not switch to a staged database with the same workspace identity.'
    }
    $beforeDowngradeHash = State-Digest
    Install-Artifact $old $true
    if ((Get-ItemPropertyValue -Path $registry -Name CurrentVersion) -ne $new.version -or (State-Digest) -ne $beforeDowngradeHash) {
        throw 'Downgrade changed the current package or workspace identity.'
    }
    $status.tests += @('W09 real installer upgrade with unchanged Character and immediate creation on the same Release',
        'W10 older installer refused without changing the active package or workspace')

    $status.phase = 'uninstall and reinstall'
    $uninstaller = Join-Path $install 'Uninstall.exe'
    $remove = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru
    if (-not $remove.WaitForExit(120000) -or $remove.ExitCode -ne 0) { throw 'Uninstall did not exit cleanly.' }
    Wait-Until { -not (Test-Path $registry) -and -not (Test-Path -LiteralPath $shortcutFile) -and
        -not (Test-Path -LiteralPath $new.launcher) -and -not (Test-Path -LiteralPath $old.launcher) } 'application uninstall'
    if ((State-Digest) -ne $beforeDowngradeHash) { throw 'Uninstall changed the saved workspace.' }
    Install-Artifact $new
    Start-Launcher $new
    Run-Probe $new 'reinstall'
    Close-Launcher
    $status.tests += 'W11 uninstall and reinstall preserve the original workspace'
    $status.phase = 'complete'
    $status.result = 'passed'
} catch {
    $status.error = $_.Exception.Message
    throw
} finally {
    foreach ($listener in $listeners) { $listener.Stop() }
    try { Close-Launcher }
    catch { $status.result = 'failed'; $status.cleanupError = $_.Exception.Message; Write-Warning $status.cleanupError }
    $env:Path = $pathBefore
    $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summary -Encoding UTF8
    Write-Host "Evidence: $evidence"
}
