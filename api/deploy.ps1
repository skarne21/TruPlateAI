# Deploy the API to Cloud Run.
#
# Run `gcloud auth login` first, and create a project with billing enabled --
# both need a browser and your Google account, so neither can be scripted.
#
#   .\deploy.ps1 -ProjectId truplate-ai -WebOrigin https://truplate.vercel.app
#
# Safe to re-run: secrets get a new version rather than erroring, and a deploy
# replaces the previous revision.

param(
    [Parameter(Mandatory = $true)][string]$ProjectId,
    # Where the front end will be served from. Cloud Run refuses browser
    # requests from anywhere else, so this and Vercel must point at each other.
    [Parameter(Mandatory = $true)][string]$WebOrigin,
    [string]$Region = "us-central1",
    [string]$Service = "truplate-api"
)

$ErrorActionPreference = "Stop"
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if (-not (Test-Path $gcloud)) { $gcloud = "gcloud" }

# Read api/.env rather than asking for keys on the command line -- typed
# secrets end up in PowerShell history, and pasted ones end up in scrollback.
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) { throw "No .env at $envPath" }

$config = @{}
foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $config[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}

# Split by how each value is treated: a secret is versioned and access-controlled
# by Secret Manager, while the rest are plain settings visible in the console.
$secretNames = @("GEMINI_API_KEY", "USDA_API_KEY", "SUPABASE_SERVICE_KEY")
$plainNames = @("SUPABASE_URL", "SUPABASE_ANON_KEY")

foreach ($name in ($secretNames + $plainNames)) {
    if (-not $config.ContainsKey($name) -or -not $config[$name]) {
        throw "$name missing from .env"
    }
}

Write-Host "Project: $ProjectId   Region: $Region   Service: $Service"
& $gcloud config set project $ProjectId | Out-Null

Write-Host "`nEnabling services (no-op if already on)..."
& $gcloud services enable run.googleapis.com cloudbuild.googleapis.com `
    artifactregistry.googleapis.com secretmanager.googleapis.com

Write-Host "`nStoring secrets..."
foreach ($name in $secretNames) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        # WriteAllText, not Set-Content: Set-Content appends a newline, which
        # becomes part of the secret and makes the key silently fail to
        # authenticate -- a very confusing 401 from Gemini.
        [System.IO.File]::WriteAllText($tmp, $config[$name])

        $exists = & $gcloud secrets describe $name 2>$null
        if ($LASTEXITCODE -eq 0) {
            & $gcloud secrets versions add $name --data-file=$tmp | Out-Null
            Write-Host "  $name (new version)"
        } else {
            & $gcloud secrets create $name --data-file=$tmp --replication-policy=automatic | Out-Null
            Write-Host "  $name (created)"
        }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# Cloud Run runs as a service account, which by default cannot read secrets.
$projectNumber = (& $gcloud projects describe $ProjectId --format="value(projectNumber)").Trim()
$runtimeSa = "$projectNumber-compute@developer.gserviceaccount.com"
Write-Host "`nGranting $runtimeSa access to the secrets..."
foreach ($name in $secretNames) {
    # Not silenced: if this fails, the deploy still succeeds and the container
    # then crashes on startup unable to read its own configuration. A warning
    # here is far cheaper than reading Cloud Run logs to find that out.
    $result = & $gcloud secrets add-iam-policy-binding $name `
        --member="serviceAccount:$runtimeSa" `
        --role="roles/secretmanager.secretAccessor" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "could not grant access to ${name}: $($result | Select-Object -Last 1)"
    } else {
        Write-Host "  $name readable by the service account"
    }
}

# Env vars go in a file rather than on the command line. --set-env-vars splits
# on commas, and WEB_ORIGINS is itself a comma-separated list; gcloud's ^@^
# custom-delimiter syntax is the documented escape hatch, but gcloud on Windows
# is a .cmd batch file and cmd.exe treats ^ as its own escape character, so the
# delimiter is eaten before gcloud ever sees it. A file sidesteps shell quoting
# entirely.
$envFile = Join-Path ([System.IO.Path]::GetTempPath()) "truplate-env-$PID.yaml"
@"
SUPABASE_URL: "$($config['SUPABASE_URL'])"
SUPABASE_ANON_KEY: "$($config['SUPABASE_ANON_KEY'])"
WEB_ORIGINS: "$WebOrigin"
"@ | Set-Content -Path $envFile -Encoding utf8

$secretRefs = ($secretNames | ForEach-Object { "$_=$($_):latest" }) -join ","

Write-Host "`nBuilding and deploying (first run takes a few minutes)..."
# --source builds with Cloud Build in the cloud, so local Docker is not needed.
# --allow-unauthenticated means Google does not demand credentials at the door;
# every route still verifies a Supabase session token itself.
try {
    & $gcloud run deploy $Service `
        --source . `
        --region $Region `
        --allow-unauthenticated `
        --env-vars-file $envFile `
        --set-secrets $secretRefs
} finally {
    Remove-Item $envFile -Force -ErrorAction SilentlyContinue
}

if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }

$url = (& $gcloud run services describe $Service --region $Region --format="value(status.url)").Trim()

Write-Host "`nDeployed: $url"
Write-Host "Checking it answers..."
try {
    $health = Invoke-RestMethod "$url/health" -TimeoutSec 60
    Write-Host "  /health    -> $($health | ConvertTo-Json -Compress)"
    $db = Invoke-RestMethod "$url/health/db" -TimeoutSec 60
    Write-Host "  /health/db -> $($db | ConvertTo-Json -Compress)   (a real database round trip)"
} catch {
    Write-Warning "  health check failed: $_"
    Write-Warning "  logs: gcloud run services logs read $Service --region $Region"
}

Write-Host @"

Next:
  1. Set NEXT_PUBLIC_API_URL = $url in Vercel, then redeploy the front end.
  2. If the front end's real URL differs from $WebOrigin, re-run this with the
     correct -WebOrigin, or browser requests will be refused.
  3. Keep the database awake:
     gcloud scheduler jobs create http truplate-keepalive ``
         --schedule "0 9 */3 * *" --uri "$url/health/db" ``
         --http-method GET --location $Region
"@
