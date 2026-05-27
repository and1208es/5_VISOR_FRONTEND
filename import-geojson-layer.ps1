param(
  [Parameter(Mandatory = $true)] [string]$LayerName,
  [Parameter(Mandatory = $true)] [string]$GeoJsonFile,
  [string]$Schema = "geoportal",
  [string]$DbContainer = "geoportal_db",
  [string]$DbName,
  [string]$DbUser,
  [string]$DbPassword,
  [switch]$Append,
  [switch]$PublishToGeoServer,
  [switch]$AddToFrontend,
  [string]$FrontendLabel,
  [string]$GeoServerUrl = "http://localhost:8081/geoserver",
  [string]$Workspace = "geoportal",
  [string]$Store = "geoportal_postgis",
  [string]$GeoServerUser,
  [string]$GeoServerPassword
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

function Convert-ToSafeIdentifier {
  param([string]$Value)

  $normalized = $Value.ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "[^a-z0-9_]+", "_")
  $normalized = [regex]::Replace($normalized, "_+", "_")
  $normalized = $normalized.Trim("_")

  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return "col_unnamed"
  }

  if ($normalized -match "^[0-9]") {
    $normalized = "col_" + $normalized
  }

  return $normalized
}

function Quote-Identifier {
  param([string]$Identifier)
  return '"' + $Identifier.Replace('"', '""') + '"'
}

function Get-NullableText {
  param($Value)

  if ($null -eq $Value) { return $null }
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return $text.Trim()
}

function Convert-ToSqlLiteral {
  param($Value)

  if ($null -eq $Value) {
    return "NULL"
  }

  if ($Value -is [bool]) {
    return $Value.ToString().ToUpperInvariant()
  }

  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
    return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $Value)
  }

  return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Convert-GeometryToSql {
  param($Geometry)

  if ($null -eq $Geometry) {
    throw "La geometria no puede ser nula."
  }

  $geometryJson = $Geometry | ConvertTo-Json -Compress -Depth 100
  return "ST_SetSRID(ST_GeomFromGeoJSON(" + (Convert-ToSqlLiteral -Value $geometryJson) + "), 4326)"
}

function Get-FeatureCollection {
  param([string]$FilePath)

  if (-not (Test-Path $FilePath)) {
    throw "No se encontro el archivo: $FilePath"
  }

  $json = Get-Content -Path $FilePath -Raw | ConvertFrom-Json
  if ($null -eq $json.features) {
    throw "El archivo no contiene una coleccion GeoJSON valida: $FilePath"
  }

  return $json.features
}

function Test-IsBooleanValue {
  param($Value)
  return $Value -is [bool] -or $Value -in @("true", "false", "TRUE", "FALSE")
}

function Test-IsNumericValue {
  param($Value)
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
    return $true
  }

  $text = Get-NullableText -Value $Value
  if ($null -eq $text) {
    return $false
  }

  $normalized = $text.Replace(",", ".")
  $number = 0.0
  return [double]::TryParse($normalized, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)
}

function Infer-ColumnType {
  param([object[]]$Values)

  $nonEmpty = @($Values | Where-Object { $null -ne $_ -and $_ -ne "" })
  if ($nonEmpty.Count -eq 0) {
    return "TEXT"
  }

  $allBoolean = $true
  $allNumeric = $true

  foreach ($value in $nonEmpty) {
    if (-not (Test-IsBooleanValue -Value $value)) { $allBoolean = $false }
    if (-not (Test-IsNumericValue -Value $value)) { $allNumeric = $false }
  }

  if ($allBoolean) { return "BOOLEAN" }
  if ($allNumeric) { return "NUMERIC(18,6)" }
  return "TEXT"
}

function Convert-ValueForColumnType {
  param(
    $Value,
    [string]$ColumnType
  )

  if ($null -eq $Value -or $Value -eq "") {
    return $null
  }

  if ($ColumnType -eq "BOOLEAN") {
    if ($Value -is [bool]) { return $Value }
    return ([string]$Value).ToLowerInvariant() -eq "true"
  }

  if ($ColumnType -eq "NUMERIC(18,6)") {
    $normalized = ([string]$Value).Replace(",", ".")
    return [double]::Parse($normalized, [System.Globalization.CultureInfo]::InvariantCulture)
  }

  return [string]$Value
}

function Update-FrontendLayerConfig {
  param(
    [string]$ConfigPath,
    [string]$LayerId,
    [string]$Label,
    [string]$TypeName
  )

  $config = @{ extraLayers = @() }
  if (Test-Path $ConfigPath) {
    $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    if ($null -eq $config.extraLayers) {
      $config | Add-Member -NotePropertyName extraLayers -NotePropertyValue @()
    }
  }

  $existing = $config.extraLayers | Where-Object { $_.id -eq $LayerId }
  if ($existing) {
    $existing.label = $Label
    $existing.typeName = $TypeName
  }
  else {
    $config.extraLayers += [pscustomobject]@{
      id = $LayerId
      label = $Label
      typeName = $TypeName
      visible = $true
    }
  }

  $json = $config | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($ConfigPath, $json, [System.Text.Encoding]::UTF8)
}

$envMap = Read-DotEnv -Path ".env"

if (-not $DbName -and $envMap.ContainsKey("POSTGRES_DB")) { $DbName = $envMap["POSTGRES_DB"] }
if (-not $DbUser -and $envMap.ContainsKey("POSTGRES_USER")) { $DbUser = $envMap["POSTGRES_USER"] }
if (-not $DbPassword -and $envMap.ContainsKey("POSTGRES_PASSWORD")) { $DbPassword = $envMap["POSTGRES_PASSWORD"] }
if (-not $GeoServerUser -and $envMap.ContainsKey("GEOSERVER_ADMIN_USER")) { $GeoServerUser = $envMap["GEOSERVER_ADMIN_USER"] }
if (-not $GeoServerPassword -and $envMap.ContainsKey("GEOSERVER_ADMIN_PASSWORD")) { $GeoServerPassword = $envMap["GEOSERVER_ADMIN_PASSWORD"] }

if (-not $DbName -or -not $DbUser -or -not $DbPassword) {
  throw "Faltan credenciales de base de datos. Define POSTGRES_DB, POSTGRES_USER y POSTGRES_PASSWORD en .env o por parametros."
}

$tableName = Convert-ToSafeIdentifier -Value $LayerName
if (-not $FrontendLabel) {
  $FrontendLabel = $LayerName
}

$features = Get-FeatureCollection -FilePath $GeoJsonFile
if ($features.Count -eq 0) {
  throw "El archivo no contiene features para importar."
}

$columnMap = @{}
$propertyNames = New-Object System.Collections.Generic.List[string]
foreach ($feature in $features) {
  $properties = $feature.properties
  if ($null -eq $properties) { continue }
  foreach ($property in $properties.PSObject.Properties.Name) {
    if (-not $columnMap.ContainsKey($property)) {
      $safeName = Convert-ToSafeIdentifier -Value $property
      $suffix = 2
      while ($propertyNames -contains $safeName) {
        $safeName = (Convert-ToSafeIdentifier -Value $property) + "_" + $suffix
        $suffix++
      }
      $columnMap[$property] = $safeName
      [void]$propertyNames.Add($safeName)
    }
  }
}

$typeMap = @{}
foreach ($originalName in $columnMap.Keys) {
  $values = @()
  foreach ($feature in $features) {
    $properties = $feature.properties
    if ($null -ne $properties -and $properties.PSObject.Properties.Name -contains $originalName) {
      $values += $properties.$originalName
    }
  }
  $typeMap[$originalName] = Infer-ColumnType -Values $values
}

$sqlBuilder = New-Object System.Text.StringBuilder
[void]$sqlBuilder.AppendLine("BEGIN;")
[void]$sqlBuilder.AppendLine("CREATE SCHEMA IF NOT EXISTS " + (Quote-Identifier -Identifier $Schema) + ";")

if (-not $Append) {
  [void]$sqlBuilder.AppendLine("DROP TABLE IF EXISTS " + (Quote-Identifier -Identifier $Schema) + "." + (Quote-Identifier -Identifier $tableName) + " CASCADE;")
}

$columnDefs = New-Object System.Collections.Generic.List[string]
[void]$columnDefs.Add((Quote-Identifier -Identifier ($tableName + "_id")) + " BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY")
[void]$columnDefs.Add((Quote-Identifier -Identifier "source_file") + " TEXT")
foreach ($originalName in $columnMap.Keys) {
  [void]$columnDefs.Add((Quote-Identifier -Identifier $columnMap[$originalName]) + " " + $typeMap[$originalName])
}
[void]$columnDefs.Add((Quote-Identifier -Identifier "geom") + " geometry(Geometry, 4326) NOT NULL")
[void]$columnDefs.Add((Quote-Identifier -Identifier "created_at") + " TIMESTAMPTZ NOT NULL DEFAULT NOW()")
[void]$columnDefs.Add((Quote-Identifier -Identifier "updated_at") + " TIMESTAMPTZ NOT NULL DEFAULT NOW()")

if ($Append) {
  [void]$sqlBuilder.AppendLine("CREATE TABLE IF NOT EXISTS " + (Quote-Identifier -Identifier $Schema) + "." + (Quote-Identifier -Identifier $tableName) + " (" + ($columnDefs -join ", ") + ");")
}
else {
  [void]$sqlBuilder.AppendLine("CREATE TABLE " + (Quote-Identifier -Identifier $Schema) + "." + (Quote-Identifier -Identifier $tableName) + " (" + ($columnDefs -join ", ") + ");")
}

[void]$sqlBuilder.AppendLine("CREATE INDEX IF NOT EXISTS " + (Quote-Identifier -Identifier ("idx_" + $tableName + "_geom")) + " ON " + (Quote-Identifier -Identifier $Schema) + "." + (Quote-Identifier -Identifier $tableName) + " USING GIST (geom);")

$insertColumns = New-Object System.Collections.Generic.List[string]
[void]$insertColumns.Add((Quote-Identifier -Identifier "source_file"))
foreach ($originalName in $columnMap.Keys) {
  [void]$insertColumns.Add((Quote-Identifier -Identifier $columnMap[$originalName]))
}
[void]$insertColumns.Add((Quote-Identifier -Identifier "geom"))

foreach ($feature in $features) {
  $insertValues = New-Object System.Collections.Generic.List[string]
  [void]$insertValues.Add((Convert-ToSqlLiteral -Value (Resolve-Path $GeoJsonFile).Path))
  foreach ($originalName in $columnMap.Keys) {
    $value = $null
    if ($null -ne $feature.properties -and $feature.properties.PSObject.Properties.Name -contains $originalName) {
      $value = Convert-ValueForColumnType -Value $feature.properties.$originalName -ColumnType $typeMap[$originalName]
    }
    [void]$insertValues.Add((Convert-ToSqlLiteral -Value $value))
  }
  [void]$insertValues.Add((Convert-GeometryToSql -Geometry $feature.geometry))
  [void]$sqlBuilder.AppendLine(
    "INSERT INTO " + (Quote-Identifier -Identifier $Schema) + "." + (Quote-Identifier -Identifier $tableName) +
    " (" + ($insertColumns -join ", ") + ") VALUES (" + ($insertValues -join ", ") + ");"
  )
}

[void]$sqlBuilder.AppendLine("COMMIT;")

$tempSqlFile = Join-Path $env:TEMP ("geoportal-import-" + [System.Guid]::NewGuid().ToString("N") + ".sql")
[System.IO.File]::WriteAllText($tempSqlFile, $sqlBuilder.ToString(), [System.Text.Encoding]::UTF8)

try {
  $inputSql = Get-Content -Path $tempSqlFile -Raw
  $inputSql | & docker exec -i -e "PGPASSWORD=$DbPassword" $DbContainer psql -v ON_ERROR_STOP=1 -U $DbUser -d $DbName

  if ($LASTEXITCODE -ne 0) {
    throw "La importacion a PostGIS fallo con codigo de salida $LASTEXITCODE."
  }

  if ($PublishToGeoServer) {
    powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-geoserver-rest.ps1 -GeoServerUrl $GeoServerUrl -Workspace $Workspace -Store $Store -DbSchema $Schema -DbName $DbName -DbUser $DbUser -DbPassword $DbPassword -GeoServerUser $GeoServerUser -GeoServerPassword $GeoServerPassword -Layers @($tableName)
    if ($LASTEXITCODE -ne 0) {
      throw "La publicacion en GeoServer fallo para la capa $tableName."
    }
  }

  if ($AddToFrontend) {
    Update-FrontendLayerConfig -ConfigPath ".\layer-config.json" -LayerId $tableName -Label $FrontendLabel -TypeName ($Workspace + ":" + $tableName)
  }

  Write-Host "Importacion completada correctamente."
  Write-Host "Tabla: $Schema.$tableName"
  Write-Host "Features importadas: $($features.Count)"
  if ($PublishToGeoServer) { Write-Host "GeoServer: publicado como $Workspace`:$tableName" }
  if ($AddToFrontend) { Write-Host "Frontend: capa registrada en layer-config.json" }
}
finally {
  if (Test-Path $tempSqlFile) {
    Remove-Item -Path $tempSqlFile -Force
  }
}