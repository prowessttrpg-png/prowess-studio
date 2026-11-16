param(
    [Parameter(Mandatory)][ValidateSet('source', 'receiver')][string]$Mode,
    [Parameter(Mandatory)][string]$Artifact,
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$InputDirectory,
    [Parameter(Mandatory)][long]$InstallerArtifactId
)
$ErrorActionPreference = 'Stop'
$identity = Get-Content -LiteralPath (Join-Path $Artifact 'installer-build.json') -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath (Join-Path $Artifact 'prototype.json') -Raw | ConvertFrom-Json
$installer = Join-Path $Artifact $identity.installer
$expected = if ($Mode -eq 'source') {
    @{ run = 43767082829; commit = '775efb5ab630e45080a82b39be15adc854e81497'; tree = 'f11c4506aad2cf568faf77b221dd157eb7cb9307' }
} else {
    @{ run = 43777171367; commit = '71b6bbf4d2a5fc01de2536d26b570c9d84f50bb1'; tree = '91bbd6d5dc822ce812cfbb19f2c408627c9f4493' }
}
if ($Mode -eq 'source' -and $identity.installerSha256 -cne 'd48f37648263c269ad2ce94a0b3e4334eb109b5e3e72254e796bc477c4a939c3') {
    throw 'The CI #279 source installer hash differs.'
}
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installerHash -cne $identity.installerSha256 -or
    (Get-Item -LiteralPath $installer).Length -ne $identity.installerBytes -or
    $identity.source.commit -cne $expected.commit -or
    $identity.source.tree -cne $expected.tree) {
    throw 'Candidate installer identity mismatch.'
}
$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$install = Join-Path $local 'Prowess Studio'
$data = Join-Path $local 'Prowess Studio Data'
if ((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $data)) {
    throw 'The verifier requires a fresh per-user Studio installation and workspace.'
}
$os = Get-CimInstance Win32_OperatingSystem
$vmUuid = [Guid](Get-CimInstance Win32_ComputerSystemProduct).UUID
if ($vmUuid -eq [Guid]::Empty -or $vmUuid -eq [Guid]'ffffffff-ffff-ffff-ffff-ffffffffffff') {
    throw 'The runner did not expose a usable SMBIOS machine UUID.'
}
$machineHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($vmUuid.ToString()))).ToLowerInvariant()
$hostIdentity = @{ caption = $os.Caption; build = $os.BuildNumber; architecture = $env:PROCESSOR_ARCHITECTURE; sha256 = $machineHash; identifier = 'SMBIOS UUID' }
if ($hostIdentity.architecture -cne 'AMD64') { throw 'Use native x64 Windows.' }
if (-not (Test-Path -LiteralPath $Evidence)) { New-Item -ItemType Directory -Path $Evidence | Out-Null }
$package = Join-Path $install ('versions\' + $identity.packageId)
$launcher = Join-Path $package 'ProwessStudio.exe'
$node = Join-Path $package 'payload\runtime\node.exe'
$beforePath = $env:Path
try {
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    $setup = Start-Process -FilePath $installer -ArgumentList '/S' -WorkingDirectory $Artifact -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installer exited with $($setup.ExitCode)." }
    foreach ($file in @(
        @{ path = $launcher; sha256 = $identity.launcherSha256 },
        @{ path = (Join-Path $package 'payload\prototype.json'); sha256 = $identity.manifestSha256 },
        @{ path = $node; sha256 = $manifest.nodeSha256 }
    )) {
        if ((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) {
            throw "Installed file hash differs from the CI #279 manifest for $($file.path)."
        }
    }
    Write-Host "Verified candidate installer $installerHash and installed payload on $($os.Caption)."
    $phases = if ($Mode -eq 'source') { @('source') } else { @('restore', 'restart') }
    foreach ($phase in $phases) {
        $launch = Start-Process -FilePath $launcher -WorkingDirectory $package -PassThru
        try {
            $runDocument = Join-Path $env:RUNNER_TEMP "p15-$phase-run.json"
            @{
                ciRunId = $expected.run
                ciArtifactId = $InstallerArtifactId
                installerSha256 = $installerHash
                installerBytes = $identity.installerBytes
                source = $identity.source
                packageSha256 = $manifest.packageSha256
                host = $hostIdentity
                runId = $env:GITHUB_RUN_ID
                runAttempt = $env:GITHUB_RUN_ATTEMPT
                job = $env:GITHUB_JOB
                launcherPid = $launch.Id
                installWasFresh = $true
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $runDocument -Encoding utf8
            & $node (Join-Path $PSScriptRoot 'proof.mjs') $phase $data $Artifact $Evidence $InputDirectory $runDocument
            if ($LASTEXITCODE -ne 0) { throw "P15 $phase proof exited $LASTEXITCODE." }
            if (-not $launch.WaitForExit(40000) -or $launch.ExitCode -ne 0) { throw "The launcher did not quit cleanly after $phase." }
        } finally {
            if (-not $launch.HasExited) {
                $quit = Start-Process -FilePath $launcher -ArgumentList '--quit' -WorkingDirectory $package -PassThru
                $null = $quit.WaitForExit(40000)
                $null = $launch.WaitForExit(40000)
            }
        }
    }
} finally {
    $env:Path = $beforePath
}
