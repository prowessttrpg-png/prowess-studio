[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ArtifactDirectory,
    [Parameter(Mandatory)] [string] $EvidenceDirectory,
    [string] $ExpectedCommit,
    [switch] $BuildRunner
)

$ErrorActionPreference = 'Stop'
$artifact = (Get-Item -LiteralPath $ArtifactDirectory).FullName
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $evidence) { throw 'Use a new evidence directory.' }
New-Item -ItemType Directory -Path $evidence | Out-Null
$identityPath = Join-Path $artifact 'installer-build.json'
$manifestPath = Join-Path $artifact 'prototype.json'
$identity = Get-Content -LiteralPath $identityPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($identity.installer -cnotmatch '^ProwessStudio-\d+\.\d+\.\d+-[a-f0-9]{12}-Windows-x64\.exe$' -or
    $identity.packageId -cne ($manifest.appVersion + '-' + $manifest.packageSha256.Substring(0, 12)) -or
    $identity.source.commit -cne $manifest.build.commit -or $identity.source.tree -cne $manifest.build.tree) {
    throw 'Installer build and package identities differ.'
}
if ($ExpectedCommit -and $identity.source.commit -cne $ExpectedCommit) { throw 'The installer is from another source commit.' }
function Test-Digest([string] $File, [string] $Sha256) {
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA-256 mismatch: $([IO.Path]::GetFileName($File))"
    }
}
$installer = Join-Path $artifact $identity.installer
Test-Digest $installer $identity.installerSha256
Test-Digest $manifestPath $identity.manifestSha256
if ((Get-Item -LiteralPath $installer).Length -ne $identity.installerBytes) { throw 'Installer size mismatch.' }
$hostProbe = Join-Path $artifact 'windows-proof-environment.ps1'
$targetProcessId = $PID
$verifier = & $hostProbe | ConvertFrom-Json
if ($verifier.nativeMachine -ne 0x8664 -or $verifier.processMachine -ne 0) { throw 'Use a native Windows x64 verifier.' }
if (-not $BuildRunner -and ($verifier.productType -ne 1 -or $verifier.caption -notmatch 'Windows 11' -or
    $verifier.isElevated -or $verifier.isAdministrator -or $verifier.elevationType -ne 1)) {
    throw 'Use a clean standard account on native Windows 11 x64.'
}
$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$install = Join-Path $local 'Prowess Studio'
$data = Join-Path $local 'Prowess Studio Data'
if ((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $data)) {
    throw 'Run this test from a disposable account without an existing installation or workspace.'
}

$package = Join-Path $install ('versions\' + $identity.packageId)
$launcher = Join-Path $package 'ProwessStudio.exe'
$installedManifest = Join-Path $package 'payload\prototype.json'
$node = Join-Path $package 'payload\runtime\node.exe'
$script = Join-Path $artifact 'installed-smoke.mjs'
$first = Join-Path $evidence 'workspace-smoke.json'
$summary = Join-Path $evidence 'installed-evidence.json'
$beforePath = $env:Path
$status = [ordered]@{
    format = 1; result = 'failed'; cleanMachine = -not $BuildRunner.IsPresent
    verifier = $verifier; source = $identity.source; installerSha256 = $identity.installerSha256
    installerBytes = $identity.installerBytes; manifestSha256 = $identity.manifestSha256
    packageSha256 = $manifest.packageSha256; migrations = $manifest.migrations
    tests = @()
}
$launch = $null
try {
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($command in @('node.exe', 'git.exe', 'pnpm.cmd', 'postgres.exe')) {
        if (Get-Command $command -ErrorAction SilentlyContinue) { throw "$command is visible to the test through PATH." }
    }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $setup = Start-Process -FilePath $installer -ArgumentList '/S' -WorkingDirectory $artifact -Wait -PassThru
    $status.installMilliseconds = [int]$clock.ElapsedMilliseconds
    if ($setup.ExitCode -ne 0) { throw "Installer returned $($setup.ExitCode)." }
    Test-Digest $launcher $identity.launcherSha256
    Test-Digest $installedManifest $identity.manifestSha256
    Test-Digest $node $manifest.nodeSha256
    $shortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) 'Prowess Studio.lnk'
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf) -or $shortcut.TargetPath -ne $launcher) {
        throw 'The installer did not register the expected desktop shortcut.'
    }
    $status.tests += 'per-user installation and shortcut'
    Push-Location $artifact
    try {
        $launch = Start-Process -FilePath $launcher -WorkingDirectory $package -PassThru
        $targetProcessId = $launch.Id
        $status.launcher = & $hostProbe | ConvertFrom-Json
        if ($status.launcher.isElevated -ne $verifier.isElevated -or
            $status.launcher.isAdministrator -ne $verifier.isAdministrator -or
            $status.launcher.nativeMachine -ne 0x8664 -or $status.launcher.processMachine -ne 0) {
            throw 'The installed launcher process has an unexpected Windows token or architecture.'
        }
        & $node $script initial $data $installedManifest $first
        if ($LASTEXITCODE -ne 0) { throw 'The installed workspace smoke failed.' }
        if (-not $launch.WaitForExit(35000) -or $launch.ExitCode -ne 0) { throw 'The first launcher did not exit cleanly.' }
        $status.tests += @('demo first run', 'local HTTP isolation', 'Character creation and Release identity',
            'backup and restore with exact Character fingerprint', 'invalid backup refusal', 'stale browser session refusal')
        $launch = Start-Process -FilePath $launcher -WorkingDirectory $package -PassThru
        & $node $script restart $data $installedManifest $first
        if ($LASTEXITCODE -ne 0) { throw 'The installed restart smoke failed.' }
        if (-not $launch.WaitForExit(35000) -or $launch.ExitCode -ne 0) { throw 'The restarted launcher did not exit cleanly.' }
        $status.tests += 'owned processes restart with exact Character'
    } finally { Pop-Location }
    $status.result = 'passed'
} catch {
    $status.error = $_.Exception.Message
    throw
} finally {
    $env:Path = $beforePath
    $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summary -Encoding UTF8
    if ($launch -and -not $launch.HasExited -and (Test-Path -LiteralPath $launcher)) {
        Start-Process -FilePath $launcher -ArgumentList '--quit' -WorkingDirectory $package -Wait
    }
    Write-Host "Evidence: $summary"
}
