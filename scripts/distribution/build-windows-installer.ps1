[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [Parameter(Mandatory)] [string] $MakeNsis
)

$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'Run the installer build on native Windows x64.'
}

function Invoke-BuildCommand([string] $Executable, [string[]] $Arguments) {
    & $Executable @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Build command failed ($LASTEXITCODE): $Executable" }
}

function Get-PinnedFile([string] $Url, [string] $Destination, [string] $Sha256) {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ne $Sha256) {
        throw "Download SHA-256 mismatch: $Url"
    }
}

$source = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '..\..')).FullName
$compiler = (Get-Item -LiteralPath $MakeNsis).FullName
$compilerVersion = & $compiler /VERSION
if ($LASTEXITCODE -ne 0 -or $compilerVersion -notmatch '^v?3\.12(?:\s|$)') { throw 'Use NSIS 3.12.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Use a new output directory.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('pwo1-build-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
if ($work -notmatch '^[\x20-\x7e]+$') { throw 'Use an ASCII maintainer build temporary directory.' }
New-Item -ItemType Directory -Path $work | Out-Null

$nodeSha = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
$nodeUrl = 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip'
$goSha = '178ab98950ac69ab25069307dc6ade79f3816e414cce95b4da166a115cde1e7e'
$goUrl = 'https://go.dev/dl/go1.27.4.windows-amd64.zip'
$crtSha = '4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5'
$crtUrl = 'https://download.visualstudio.microsoft.com/download/pr/45d3b8dd-bced-4b37-9974-142f748d710c/4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5/Microsoft.VC.14.44.17.14.CRT.Redist.X64.base.vsix'
$pgUrl = 'https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-16.14.0-beta.17.tgz'
$pgArchive = Join-Path $work 'postgres.tgz'
$stage = Join-Path $work 'payload'
$build = Join-Path $work 'build'
$launcher = Join-Path $work 'ProwessStudio.exe'
$beforePath = $env:Path
$beforeToolchain = $env:GOTOOLCHAIN
$beforeCgo = $env:CGO_ENABLED
$finished = $false
try {
    foreach ($pin in @(
        @{ url = $nodeUrl; name = 'node.zip'; sha256 = $nodeSha }
        @{ url = $goUrl; name = 'go.zip'; sha256 = $goSha }
        @{ url = $crtUrl; name = 'crt.zip'; sha256 = $crtSha }
    )) {
        Get-PinnedFile $pin.url (Join-Path $work $pin.name) $pin.sha256
    }
    Invoke-WebRequest -UseBasicParsing -Uri $pgUrl -OutFile $pgArchive
    Expand-Archive -LiteralPath (Join-Path $work 'node.zip') -DestinationPath $work
    Expand-Archive -LiteralPath (Join-Path $work 'go.zip') -DestinationPath $work
    $crt = Join-Path $work 'MSVC\14.44.35112\x64\Microsoft.VC143.CRT'
    New-Item -ItemType Directory -Path $crt | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $crtPackage = [IO.Compression.ZipFile]::OpenRead((Join-Path $work 'crt.zip'))
    try {
        foreach ($entry in $crtPackage.Entries) {
            if ($entry.FullName -cmatch '^Contents/VC/Redist/MSVC/14\.44\.35112/x64/Microsoft\.VC143\.CRT/([A-Za-z0-9_]+\.dll)$') {
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $crt $Matches[1]))
            }
        }
    } finally { $crtPackage.Dispose() }
    foreach ($dll in (Get-ChildItem -LiteralPath $crt -Filter '*.dll' -File)) {
        $signature = Get-AuthenticodeSignature -LiteralPath $dll.FullName
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)(?:CN|O)=Microsoft Corporation(?:,|$)') {
            throw "Invalid Microsoft signature on $($dll.Name)."
        }
    }

    $node = Join-Path $work 'node-v22.23.4-win-x64\node.exe'
    $go = Join-Path $work 'go\bin\go.exe'
    $env:Path = (Split-Path -Parent $node) + ';' + $beforePath
    $env:GOTOOLCHAIN = 'local'
    $env:CGO_ENABLED = '0'
    Invoke-BuildCommand $node @((Join-Path $PSScriptRoot 'build-prototype.mjs'), $build)
    Invoke-BuildCommand $node @((Join-Path $build 'scripts\distribution\stage-prototype.mjs'), $stage, $pgArchive, $crt)
    Invoke-BuildCommand $node @((Join-Path $build 'scripts\distribution\prepare-desktop-demo.mjs'), $stage)
    $manifestFile = Join-Path $stage 'prototype.json'
    $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.appVersion -cnotmatch '^\d+\.\d+\.\d+$' -or $manifest.packageSha256 -cnotmatch '^[a-f0-9]{64}$') {
        throw 'Invalid package identity.'
    }
    $distribution = Join-Path $build 'scripts\distribution'
    Push-Location (Join-Path $distribution 'desktop\native')
    try { Invoke-BuildCommand $go @('build', '-trimpath', '-buildvcs=false', '-ldflags=-H windowsgui', '-o', $launcher, '.') }
    finally { Pop-Location }

    $payloadArchive = Join-Path $work 'payload.zip'
    Invoke-BuildCommand 'tar.exe' @('-a', '-cf', $payloadArchive, '--options', 'zip:compression=store', '-C', $stage, '.')
    $payloadSha256 = (Get-FileHash -LiteralPath $payloadArchive -Algorithm SHA256).Hash.ToLowerInvariant()

    New-Item -ItemType Directory -Path $output | Out-Null
    $packageId = $manifest.appVersion + '-' + $manifest.packageSha256.Substring(0, 12)
    $installer = Join-Path $output ('ProwessStudio-' + $packageId + '-Windows-x64.exe')
    Invoke-BuildCommand $compiler @(
        '/V3', "/DVERSION=$($manifest.appVersion)", "/DPACKAGE_ID=$packageId", "/DOUTPUT=$installer",
        "/DLAUNCHER=$launcher", "/DGO_LICENSE=$(Join-Path $work 'go\LICENSE')",
        "/DPAYLOAD_ARCHIVE=$payloadArchive", "/DPAYLOAD_SHA256=$payloadSha256",
        (Join-Path $distribution 'desktop\installer.nsi')
    )
    Copy-Item -LiteralPath $manifestFile -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'verify-windows-installer.ps1') -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'verify-windows-lifecycle.ps1') -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'verify-windows-upgrade.ps1') -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'desktop\installed-smoke.mjs') -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'desktop\installed-lifecycle.mjs') -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'desktop\installed-upgrade.mjs') -Destination $output
    Copy-Item -LiteralPath (Join-Path $distribution 'windows-proof-environment.ps1') -Destination $output
    $buildIdentity = [ordered]@{
        format = 1
        installer = [IO.Path]::GetFileName($installer)
        installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        installerBytes = (Get-Item -LiteralPath $installer).Length
        launcherSha256 = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
        manifestSha256 = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
        payloadArchiveSha256 = $payloadSha256
        source = $manifest.build
        packageId = $packageId
        signing = 'unsigned internal test'
        tools = @{ nsis = $compilerVersion; go = @{ version = '1.27.4'; url = $goUrl; sha256 = $goSha } }
        redistributables = @{ node = @{ url = $nodeUrl; sha256 = $nodeSha }; crt = @{ url = $crtUrl; sha256 = $crtSha }; postgres = $manifest.postgres }
    }
    $buildIdentity | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'installer-build.json') -Encoding UTF8
    Write-Host "Installer: $installer"
    Write-Host "SHA-256: $($buildIdentity.installerSha256)"
    $finished = $true
} finally {
    $env:Path = $beforePath
    $env:GOTOOLCHAIN = $beforeToolchain
    $env:CGO_ENABLED = $beforeCgo
    if ($finished) {
        try {
            # The worktree and payload can contain dependency paths longer than MAX_PATH.
            $removeBuildTrees = @'
const { rmSync } = require('node:fs');
const { toNamespacedPath } = require('node:path');
for (const directory of process.argv.slice(1)) {
    rmSync(toNamespacedPath(directory), { recursive: true, force: true, maxRetries: 3 });
}
'@
            Invoke-BuildCommand $node @('-e', $removeBuildTrees, $build, $stage)
            Invoke-BuildCommand 'git' @('-C', $source, 'worktree', 'remove', '--force', $build)
            Remove-Item -LiteralPath $work -Recurse -Force
        } catch {
            Write-Warning "The installer was built. Temporary files may remain under $work. $($_.Exception.Message)"
        }
    } else {
        Write-Host "Build files for diagnosis: $work"
    }
}
