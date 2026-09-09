param(
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $repoRoot ".library-update.log"
$allowedFiles = @(
    "library-sites-data.json",
    "library-update-state.json",
    "rules-data.js"
)

function Write-UpdateLog {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message" -Encoding UTF8
}

function Invoke-CheckedCommand {
    param(
        [string]$Program,
        [string[]]$Arguments
    )

    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

try {
    Set-Location -LiteralPath $repoRoot
    Write-UpdateLog "Starting incremental library-site refresh."

    $trackedChanges = @(git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect the Git working tree."
    }
    if ($trackedChanges.Count -gt 0) {
        Write-UpdateLog "Skipped: tracked working-tree changes are present."
        exit 0
    }

    Invoke-CheckedCommand "git" @("pull", "--ff-only", "origin", "main")
    Invoke-CheckedCommand "python" @(
        "scripts/scrape_library_sites.py",
        "--one",
        "--workers", "1",
        "--delay", "1.2"
    )
    Invoke-CheckedCommand "python" @(
        "scripts/build_rules_data.py",
        "--reuse-existing-regulations",
        "--preserve-curated-versions"
    )
    Invoke-CheckedCommand "npm.cmd" @("test")
    Invoke-CheckedCommand "git" @("diff", "--check")

    $changedFiles = @(git diff --name-only)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect generated changes."
    }

    $unexpectedFiles = @($changedFiles | Where-Object { $_ -notin $allowedFiles })
    if ($unexpectedFiles.Count -gt 0) {
        throw "Unexpected files changed: $($unexpectedFiles -join ', ')"
    }
    if ($changedFiles.Count -eq 0) {
        Write-UpdateLog "Completed: official pages were unchanged."
        exit 0
    }

    Invoke-CheckedCommand "git" (@("add", "--") + $allowedFiles)
    Invoke-CheckedCommand "git" @("commit", "-m", "chore: refresh one library site")

    if (-not $SkipPush) {
        Invoke-CheckedCommand "git" @("push", "origin", "main")
        Write-UpdateLog "Completed: verified data was committed and pushed."
    } else {
        Write-UpdateLog "Completed: verified data was committed locally (push skipped)."
    }
} catch {
    Write-UpdateLog "Failed safely: $($_.Exception.Message)"
    exit 1
}
