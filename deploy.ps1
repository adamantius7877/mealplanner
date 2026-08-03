#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ComposeFile = "docker-compose.yml",
    [string]$AppName = "meals-and-grocery-dashboard"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-DockerCompose {
    param([string[]]$Arguments)

    & docker compose @Arguments
    if ($LASTEXITCODE -eq 0) {
        return
    }

    $dockerCompose = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($null -eq $dockerCompose) {
        throw "Docker Compose failed, and docker-compose was not found as a fallback."
    }

    & $dockerCompose.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose exited with code $LASTEXITCODE."
    }
}

Write-Step "Checking Docker"
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
    throw "Docker is required but was not found. Install Docker Desktop, start it, and run this script again."
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is installed but is not responding. Start Docker Desktop and run this script again."
}

if (-not (Test-Path -LiteralPath $ComposeFile)) {
    throw "Could not find $ComposeFile. Run this script from the mealplanner project folder."
}

if (-not (Test-Path -LiteralPath ".env") -and (Test-Path -LiteralPath ".env.example")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "Created .env from .env.example. Update SHARED_FOOD_SERVER there if CaloriesDashboard is on another machine."
}

Write-Step "Deploying $AppName"
Invoke-DockerCompose -Arguments @("-f", $ComposeFile, "up", "-d", "--build", "--remove-orphans")

Write-Step "Done"
Write-Host "$AppName is running."
Write-Host "Open http://localhost:3002 on this machine, or http://SERVER_IP:3002 from another device."
Write-Host ""
Write-Host "Your list and history data is stored in the Docker volume named meals-data."
Write-Host "Shared meal-library data is stored by CaloriesDashboard when SHARED_FOOD_SERVER is configured."
Write-Host "Redeploying with this script rebuilds the app without deleting the meals-data volume."
