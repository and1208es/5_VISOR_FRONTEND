param(
  [string]$GeoServerUrl = "http://localhost:8081/geoserver",
  [string]$Workspace = "geoportal",
  [string]$Store = "geoportal_postgis",
  [string]$DbHost = "db",
  [int]$DbPort = 5432,
  [string]$DbName = "geoportal",
  [string]$DbSchema = "public",
  [string]$DbUser,
  [string]$DbPassword,
  [string]$GeoServerUser,
  [string]$GeoServerPassword,
  [string[]]$Layers = @("capa_lotes", "capa_manzanas")
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
  param([string]$Path)

  $map = @{}
  if (-not (Test-Path $Path)) {
    return $map
  }

  foreach ($line in Get-Content -Path $Path) {
    $trim = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trim) -or $trim.StartsWith("#")) {
      continue
    }

    $idx = $trim.IndexOf("=")
    if ($idx -lt 1) {
      continue
    }

    $key = $trim.Substring(0, $idx).Trim()
    $value = $trim.Substring($idx + 1).Trim()
    $map[$key] = $value
  }

  return $map
}

function New-BasicAuthHeader {
  param(
    [Parameter(Mandatory = $true)] [string]$User,
    [Parameter(Mandatory = $true)] [string]$Password
  )

  $bytes = [System.Text.Encoding]::UTF8.GetBytes("$User`:$Password")
  $token = [System.Convert]::ToBase64String($bytes)
  return @{ Authorization = "Basic $token" }
}

function Invoke-GeoServerJson {
  param(
    [Parameter(Mandatory = $true)] [string]$Method,
    [Parameter(Mandatory = $true)] [string]$Url,
    [hashtable]$Headers,
    [string]$Body,
    [string]$ContentType = "application/json"
  )

  if ($Body) {
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -Body $Body -ContentType $ContentType
  }

  return Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers
}

$envMap = Read-DotEnv -Path ".env"

if (-not $DbUser -and $envMap.ContainsKey("POSTGRES_USER")) { $DbUser = $envMap["POSTGRES_USER"] }
if (-not $DbPassword -and $envMap.ContainsKey("POSTGRES_PASSWORD")) { $DbPassword = $envMap["POSTGRES_PASSWORD"] }
if (-not $GeoServerUser -and $envMap.ContainsKey("GEOSERVER_ADMIN_USER")) { $GeoServerUser = $envMap["GEOSERVER_ADMIN_USER"] }
if (-not $GeoServerPassword -and $envMap.ContainsKey("GEOSERVER_ADMIN_PASSWORD")) { $GeoServerPassword = $envMap["GEOSERVER_ADMIN_PASSWORD"] }

if (-not $DbUser -or -not $DbPassword) {
  throw "Faltan credenciales de base de datos. Define POSTGRES_USER y POSTGRES_PASSWORD en .env o por parametros."
}

if (-not $GeoServerUser -or -not $GeoServerPassword) {
  throw "Faltan credenciales de GeoServer. Define GEOSERVER_ADMIN_USER y GEOSERVER_ADMIN_PASSWORD en .env o por parametros."
}

$GeoServerUrl = $GeoServerUrl.TrimEnd("/")
$headers = New-BasicAuthHeader -User $GeoServerUser -Password $GeoServerPassword

# 1) Workspace
$workspaceUrl = "$GeoServerUrl/rest/workspaces/$Workspace.json"
$workspaceExists = $true
try {
  Invoke-GeoServerJson -Method Get -Url $workspaceUrl -Headers $headers | Out-Null
}
catch {
  $workspaceExists = $false
}

if (-not $workspaceExists) {
  Write-Host "Creando workspace $Workspace ..."
  $workspaceBody = "{\"workspace\":{\"name\":\"$Workspace\"}}"
  Invoke-GeoServerJson -Method Post -Url "$GeoServerUrl/rest/workspaces" -Headers $headers -Body $workspaceBody | Out-Null
}
else {
  Write-Host "Workspace ya existe: $Workspace"
}

# 2) Datastore PostGIS
$storeUrl = "$GeoServerUrl/rest/workspaces/$Workspace/datastores/$Store.json"
$storeExists = $true
try {
  Invoke-GeoServerJson -Method Get -Url $storeUrl -Headers $headers | Out-Null
}
catch {
  $storeExists = $false
}

if (-not $storeExists) {
  Write-Host "Creando datastore $Store ..."
  $storeBody = @"
{
  "dataStore": {
    "name": "$Store",
    "connectionParameters": {
      "entry": [
        { "@key": "host", "$": "$DbHost" },
        { "@key": "port", "$": "$DbPort" },
        { "@key": "database", "$": "$DbName" },
        { "@key": "schema", "$": "$DbSchema" },
        { "@key": "user", "$": "$DbUser" },
        { "@key": "passwd", "$": "$DbPassword" },
        { "@key": "dbtype", "$": "postgis" },
        { "@key": "Expose primary keys", "$": "true" }
      ]
    }
  }
}
"@

  Invoke-GeoServerJson -Method Post -Url "$GeoServerUrl/rest/workspaces/$Workspace/datastores" -Headers $headers -Body $storeBody | Out-Null
}
else {
  Write-Host "Datastore ya existe: $Store"
}

# 3) Publicar feature types (capas)
foreach ($layer in $Layers) {
  $featureUrl = "$GeoServerUrl/rest/workspaces/$Workspace/datastores/$Store/featuretypes/$layer.json"
  $exists = $true

  try {
    Invoke-GeoServerJson -Method Get -Url $featureUrl -Headers $headers | Out-Null
  }
  catch {
    $exists = $false
  }

  if ($exists) {
    Write-Host "Capa ya publicada: $Workspace`:$layer"
    continue
  }

  Write-Host "Publicando capa $Workspace`:$layer ..."
  $featureBody = "{\"featureType\":{\"name\":\"$layer\",\"nativeName\":\"$layer\",\"enabled\":true}}"
  Invoke-GeoServerJson -Method Post -Url "$GeoServerUrl/rest/workspaces/$Workspace/datastores/$Store/featuretypes" -Headers $headers -Body $featureBody | Out-Null
}

Write-Host "Configuracion REST completada."
Write-Host "Verifica WMTS: $GeoServerUrl/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"
