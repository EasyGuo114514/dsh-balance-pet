# Install dsh-balance-pet into a DeepSeek Harness profile.
#
# What it does, and why each step is here:
#   1. Adds a `link:` dependency, so the plugin directory IS the source - no
#      build step and no copy that can go stale.
#   2. Adds the package to `dsh.profile.bundles`. This is the step that actually
#      activates it: a bundle's cordis.patch.yml is only applied for packages
#      listed there, which is why a plugin can be present in node_modules and
#      still do nothing.
#   3. Creates the node_modules symlink the loader resolves through.
#   4. Validates the JSON it wrote and restores the backup on any failure.
#
# It is idempotent: running it twice changes nothing the second time.
#
# Usage:
#   pwsh -File install.ps1                 # install into the desktop profile
#   pwsh -File install.ps1 -Profile web    # a different profile
#   pwsh -File install.ps1 -Remove         # uninstall

[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$packageName = '@local/dsh-balance-pet'
$sourceDir = $PSScriptRoot

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$manifestPath = Join-Path $profileDir 'package.json'
$localScope = Join-Path $profileDir 'node_modules\@local'
$linkPath = Join-Path $localScope 'dsh-balance-pet'

if (-not (Test-Path $manifestPath)) {
    throw "profile manifest not found: $manifestPath (is the profile name right?)"
}

# Read with -Raw so the file's own content round-trips; ConvertFrom-Json would
# otherwise be paired with a ConvertTo-Json that reformats the whole document.
$original = Get-Content $manifestPath -Raw
$manifest = $original | ConvertFrom-Json

if (-not $manifest.PSObject.Properties['dependencies']) {
    $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
if (-not $manifest.PSObject.Properties['dsh']) {
    throw "profile manifest has no 'dsh' section; refusing to guess its shape"
}

$backup = "$manifestPath.dsh-balance-pet.bak"
Copy-Item $manifestPath $backup -Force

try {
    if ($Remove) {
        if ($manifest.dependencies.PSObject.Properties['@local/dsh-balance-pet']) {
            $manifest.dependencies.PSObject.Properties.Remove('@local/dsh-balance-pet')
        }
        $bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $packageName })
        $manifest.dsh.profile.bundles = $bundles
        if (Test-Path $linkPath) { Remove-Item $linkPath -Force -Recurse }
        Write-Host "removed $packageName from profile '$Profile'"
    }
    else {
        $linkTarget = $sourceDir -replace '\\', '/'
        $manifest.dependencies | Add-Member -NotePropertyName '@local/dsh-balance-pet' `
            -NotePropertyValue "link:$linkTarget" -Force

        # The bundles list is what applies the patch; without this entry the
        # plugin is installed but inactive.
        $bundles = @($manifest.dsh.profile.bundles)
        if ($bundles -notcontains $packageName) { $bundles += $packageName }
        $manifest.dsh.profile.bundles = $bundles

        New-Item -ItemType Directory -Force -Path $localScope | Out-Null
        if (Test-Path $linkPath) { Remove-Item $linkPath -Force -Recurse }
        New-Item -ItemType SymbolicLink -Path $linkPath -Target $sourceDir | Out-Null

        Write-Host "linked $linkPath -> $sourceDir"
    }

    $manifest | ConvertTo-Json -Depth 32 | Set-Content $manifestPath -Encoding UTF8

    # A malformed profile manifest can stop the application from booting, so the
    # write is verified before it is trusted.
    $null = Get-Content $manifestPath -Raw | ConvertFrom-Json
    Remove-Item $backup -Force
    Write-Host 'profile manifest validated.'
}
catch {
    Copy-Item $backup $manifestPath -Force
    Remove-Item $backup -Force -ErrorAction SilentlyContinue
    throw "install failed and the manifest was restored: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'Next: restart DeepSeek Harness for the new bundle row to load.'
Write-Host 'After restarting, confirm it mounted with:'
Write-Host "  Get-Content `"$dshHome\balance-pet\bridge.log`" -Tail 20"
