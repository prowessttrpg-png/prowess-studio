[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $CandidateArtifact,
    [Parameter(Mandatory)] [string] $BaselineArtifact,
    [Parameter(Mandatory)] [string] $BaselineCommit,
    [string] $BaselineOrigin = 'supplied directory',
    [Parameter(Mandatory)] [string] $EvidenceDirectory,
    [string] $ExpectedCommit,
    [switch] $BuildRunner
)

# Installed upgrade proof. The identified BASELINE installer (an earlier released build) is installed into a clean
# per-user test account; with that previous application a representative workspace is prepared (sample and authored
# Releases, completed and draft Characters, a prepared encounter, one Character mid-turn). The CANDIDATE installer is
# then run over that installation — the supported upgrade — and the candidate, started from its new shortcut, must keep
# every Release pin, Character, encounter membership, resource, the active turn and every play event, continue play,
# and keep it all after a restart. The backup / restore proof stays separate (verify-windows-installer.ps1).

$ErrorActionPreference = 'Stop'
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $evidence) { throw 'Use a new evidence directory.' }
New-Item -ItemType Directory -Path $evidence | Out-Null
$summary = Join-Path $evidence 'installed-upgrade-evidence.json'

function Read-Json([string] $File) { Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json }
function Test-Digest([string] $File, [string] $Sha256) {
    if ($Sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA-256 mismatch: $([IO.Path]::GetFileName($File))"
    }
}
# An installer artifact whose build identity, package identity and file digests agree, from the expected source commit.
function Get-Package([string] $Directory, [string] $Commit) {
    $folder = (Get-Item -LiteralPath $Directory).FullName
    $identity = Read-Json (Join-Path $folder 'installer-build.json')
    $manifestFile = Join-Path $folder 'prototype.json'
    $manifest = Read-Json $manifestFile
    if ($identity.installer -cnotmatch '^ProwessStudio-\d+\.\d+\.\d+-[a-f0-9]{12}-Windows-x64\.exe$' -or
        $identity.packageId -cne ($manifest.appVersion + '-' + $manifest.packageSha256.Substring(0, 12)) -or
        $identity.source.commit -cne $manifest.build.commit -or $identity.source.tree -cne $manifest.build.tree) {
        throw "Installer build and package identities differ in $folder."
    }
    if ($Commit -and $identity.source.commit -cne $Commit) {
        throw "The installer in $folder is from $($identity.source.commit), expected $Commit."
    }
    $installer = Join-Path $folder $identity.installer
    Test-Digest $installer $identity.installerSha256
    Test-Digest $manifestFile $identity.manifestSha256
    if ((Get-Item -LiteralPath $installer).Length -ne $identity.installerBytes) { throw 'Installer size mismatch.' }
    [pscustomobject]@{ Folder = $folder; Identity = $identity; Manifest = $manifest; Installer = $installer }
}

# windows-proof-environment.ps1 reports the token and architecture of the process named by $targetProcessId (this one).
$targetProcessId = $PID
$status = [ordered]@{ format = 1; proof = 'installed upgrade'; result = 'failed'; tests = @() }
try {
$candidate = Get-Package $CandidateArtifact $ExpectedCommit
$baseline = Get-Package $BaselineArtifact $BaselineCommit
if ($baseline.Identity.source.commit -ceq $candidate.Identity.source.commit) { throw 'The baseline and the candidate are the same build.' }
if ($baseline.Manifest.appVersion -ceq $candidate.Manifest.appVersion) {
    throw 'The candidate must carry a newer application version than the baseline for the launcher to upgrade it.'
}
$verifier = & (Join-Path $candidate.Folder 'windows-proof-environment.ps1') | ConvertFrom-Json
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
$shortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) 'Prowess Studio.lnk'
$proof = Join-Path $candidate.Folder 'installed-upgrade.mjs'
$record = Join-Path $evidence 'before-upgrade.json'
$result = Join-Path $evidence 'after-upgrade.json'
$beforePath = $env:Path
$status = [ordered]@{
    format = 1; proof = 'installed upgrade'; result = 'failed'; cleanMachine = -not $BuildRunner.IsPresent; verifier = $verifier
    baseline = [ordered]@{ origin = $BaselineOrigin; source = $baseline.Identity.source; appVersion = $baseline.Manifest.appVersion
        installer = $baseline.Identity.installer; installerSha256 = $baseline.Identity.installerSha256; migrations = $baseline.Manifest.migrations.Count }
    candidate = [ordered]@{ source = $candidate.Identity.source; appVersion = $candidate.Manifest.appVersion
        installer = $candidate.Identity.installer; installerSha256 = $candidate.Identity.installerSha256; migrations = $candidate.Manifest.migrations.Count }
    tests = @()
}
$launch = $null
$launcher = $null
$package = $null

function Install-Package($Package) {
    $setup = Start-Process -FilePath $Package.Installer -ArgumentList '/S' -WorkingDirectory $Package.Folder -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installer $($Package.Identity.installer) returned $($setup.ExitCode)." }
    $directory = Join-Path $install ('versions\' + $Package.Identity.packageId)
    $exe = Join-Path $directory 'ProwessStudio.exe'
    Test-Digest $exe $Package.Identity.launcherSha256
    Test-Digest (Join-Path $directory 'payload\prototype.json') $Package.Identity.manifestSha256
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -ne $exe) { throw "The desktop shortcut does not start $($Package.Identity.packageId)." }
    [pscustomobject]@{ Directory = $directory; Launcher = $exe; Manifest = (Join-Path $directory 'payload\prototype.json')
        Node = (Join-Path $directory 'payload\runtime\node.exe') }
}
function Invoke-Phase($Installed, [string[]] $Arguments, [string] $Failure) {
    $script:launcher = $Installed.Launcher
    $script:package = $Installed.Directory
    $script:launch = Start-Process -FilePath $Installed.Launcher -WorkingDirectory $Installed.Directory -PassThru
    & $Installed.Node $proof @Arguments
    if ($LASTEXITCODE -ne 0) { throw $Failure }
    if (-not $script:launch.WaitForExit(35000) -or $script:launch.ExitCode -ne 0) { throw "$Failure (the launcher did not exit cleanly)" }
}

} catch {
    $status.error = $_.Exception.Message
    $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summary -Encoding UTF8
    Write-Host "Evidence: $summary"
    throw
}

try {
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($command in @('node.exe', 'git.exe', 'pnpm.cmd', 'postgres.exe')) {
        if (Get-Command $command -ErrorAction SilentlyContinue) { throw "$command is visible to the test through PATH." }
    }
    Push-Location $candidate.Folder
    try {
        # 1. The identified previous build, installed and used as a player would.
        $previous = Install-Package $baseline
        $status.tests += "baseline $($baseline.Manifest.appVersion) ($($baseline.Identity.source.commit)) installed with verified identity"
        Invoke-Phase $previous @('prepare', $data, $previous.Manifest, $record) 'The baseline application could not prepare the representative workspace.'
        $status.tests += 'baseline prepares sample and authored Releases, Characters, an encounter and a mid-turn play state'

        # 2. The candidate installer over that installation (the supported upgrade), then the candidate from its shortcut.
        $current = Install-Package $candidate
        if (-not (Test-Path -LiteralPath $previous.Launcher -PathType Leaf)) { throw 'The upgrade removed the previous version before the workspace was upgraded.' }
        $status.tests += "candidate $($candidate.Manifest.appVersion) installed over the baseline; the shortcut starts the candidate"
        Invoke-Phase $current @('verify', $data, $current.Manifest, $record, $result) 'The upgraded workspace did not keep the baseline state or could not continue play.'
        $status.tests += 'upgrade keeps Release pins, Characters, encounter membership, resources, the active turn and play events; play continues'

        # 3. A restart of the upgraded application.
        Invoke-Phase $current @('restart', $data, $current.Manifest, $record, $result) 'The upgraded workspace did not survive a restart.'
        $status.tests += 'after a restart the preserved state and the continued play remain'
    } finally { Pop-Location }
    $status.prepared = (Read-Json $record).ids
    $outcome = Read-Json $result
    $status.preservedRows = $outcome.preservedRows
    $status.continued = $outcome.continued
    $status.recoveryBackups = $outcome.recoveryBackups
    $status.result = 'passed'
} catch {
    $status.error = $_.Exception.Message
    throw
} finally {
    $env:Path = $beforePath
    $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summary -Encoding UTF8
    if ($launch -and -not $launch.HasExited -and $launcher -and (Test-Path -LiteralPath $launcher)) {
        Start-Process -FilePath $launcher -ArgumentList '--quit' -WorkingDirectory $package -Wait
    }
    Write-Host "Evidence: $summary"
}
