param(
  [string]$DbContainer = "geoportal_db",
  [string]$DbName,
  [string]$DbUser,
  [string]$DbPassword,
  [string]$ManzanasFile = ".\data\capa_manzanas.geojson",
  [string]$LotesFile = ".\data\capa_lotes.geojson",
  [switch]$Append,
  [switch]$DryRun
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

function Get-NullableText {
  param($Value)

  if ($null -eq $Value) {
    return $null
  }

  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  return $text.Trim()
}

function Get-NullableNumber {
  param($Value)

  $text = Get-NullableText -Value $Value
  if ($null -eq $text) {
    return $null
  }

  $normalized = $text.Replace(",", ".")
  $number = 0.0
  if ([double]::TryParse($normalized, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.################}", $number)
  }

  return $null
}

function Convert-ToSqlLiteral {
  param($Value)

  if ($null -eq $Value) {
    return "NULL"
  }

  return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Get-SqlNumberLiteral {
  param($Value)

  $number = Get-NullableNumber -Value $Value
  if ($null -eq $number) {
    return "NULL"
  }

  return $number
}

function Convert-GeometryToSql {
  param($Geometry)

  if ($null -eq $Geometry) {
    throw "La geometria no puede ser nula."
  }

  $geometryJson = $Geometry | ConvertTo-Json -Compress -Depth 100
  return "ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(" + (Convert-ToSqlLiteral -Value $geometryJson) + "), 4326))"
}

function Get-FeatureCollection {
  param([string]$FilePath)

  if (-not (Test-Path $FilePath)) {
    throw "No se encontro el archivo: $FilePath"
  }

  $raw = Get-Content -Path $FilePath -Raw
  $json = $raw | ConvertFrom-Json

  if ($null -eq $json.features) {
    throw "El archivo no contiene una coleccion GeoJSON valida: $FilePath"
  }

  return $json.features
}

function Add-ManzanasInserts {
  param(
    [System.Text.StringBuilder]$Builder,
    [object[]]$Features
  )

  foreach ($feature in $Features) {
    $properties = $feature.properties
    $line = @(
      "INSERT INTO geoportal.manzanas (source_layer, source_path, id_mz, cod_mz, sector, uso_pred, obs, area_m2, perimetro_m, geom)",
      "VALUES (",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.layer)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.path)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.id_mz)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.cod_mz)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.sector)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.uso_pred)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.obs)), ", ",
      (Get-SqlNumberLiteral -Value $properties.area_m2), ", ",
      (Get-SqlNumberLiteral -Value $properties.perimetro), ", ",
      (Convert-GeometryToSql -Geometry $feature.geometry),
      ");"
    ) -join ""

    [void]$Builder.AppendLine($line)
  }
}

function Add-LotesInserts {
  param(
    [System.Text.StringBuilder]$Builder,
    [object[]]$Features
  )

  foreach ($feature in $Features) {
    $properties = $feature.properties
    $line = @(
      "INSERT INTO geoportal.lotes (source_layer, source_path, source_id, cod_catas, cod_mz, num_lote, sector, uso, estado, condicion, area_m2, perimetro_m, geom)",
      "VALUES (",
      "'capa_lotes'", ", ",
      "NULL", ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.id)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.cod_catas)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.cod_mz)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.num_lote)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.sector)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.uso)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.estado)), ", ",
      (Convert-ToSqlLiteral -Value (Get-NullableText -Value $properties.condicion)), ", ",
      (Get-SqlNumberLiteral -Value $properties.area_m2), ", ",
      (Get-SqlNumberLiteral -Value $properties.perimetro), ", ",
      (Convert-GeometryToSql -Geometry $feature.geometry),
      ");"
    ) -join ""

    [void]$Builder.AppendLine($line)
  }
}

$envMap = Read-DotEnv -Path ".env"

if (-not $DbName -and $envMap.ContainsKey("POSTGRES_DB")) { $DbName = $envMap["POSTGRES_DB"] }
if (-not $DbUser -and $envMap.ContainsKey("POSTGRES_USER")) { $DbUser = $envMap["POSTGRES_USER"] }
if (-not $DbPassword -and $envMap.ContainsKey("POSTGRES_PASSWORD")) { $DbPassword = $envMap["POSTGRES_PASSWORD"] }

if (-not $DbName -or -not $DbUser -or -not $DbPassword) {
  throw "Faltan credenciales de base de datos. Define POSTGRES_DB, POSTGRES_USER y POSTGRES_PASSWORD en .env o por parametros."
}

$null = Get-Command docker -ErrorAction Stop

$manzanas = Get-FeatureCollection -FilePath $ManzanasFile
$lotes = Get-FeatureCollection -FilePath $LotesFile

$sqlBuilder = New-Object System.Text.StringBuilder
[void]$sqlBuilder.AppendLine("BEGIN;")
[void]$sqlBuilder.AppendLine("SET search_path TO geoportal, public;")

if (-not $Append) {
  [void]$sqlBuilder.AppendLine("TRUNCATE TABLE geoportal.lotes RESTART IDENTITY CASCADE;")
  [void]$sqlBuilder.AppendLine("TRUNCATE TABLE geoportal.manzanas RESTART IDENTITY CASCADE;")
}

Add-ManzanasInserts -Builder $sqlBuilder -Features $manzanas
Add-LotesInserts -Builder $sqlBuilder -Features $lotes

[void]$sqlBuilder.AppendLine("COMMIT;")

$tempSqlFile = Join-Path $env:TEMP ("geoportal-seed-" + [System.Guid]::NewGuid().ToString("N") + ".sql")
[System.IO.File]::WriteAllText($tempSqlFile, $sqlBuilder.ToString(), [System.Text.Encoding]::UTF8)

try {
  if ($DryRun) {
    Write-Host "Modo DryRun activado. SQL generado en: $tempSqlFile"
    Write-Host "Manzanas: $($manzanas.Count)"
    Write-Host "Lotes: $($lotes.Count)"
    return
  }

  $dockerArgs = @(
    "exec",
    "-i",
    "-e", "PGPASSWORD=$DbPassword",
    $DbContainer,
    "psql",
    "-v", "ON_ERROR_STOP=1",
    "-U", $DbUser,
    "-d", $DbName
  )

  $inputSql = Get-Content -Path $tempSqlFile -Raw
  $inputSql | & docker @dockerArgs

  if ($LASTEXITCODE -ne 0) {
    throw "La carga hacia PostGIS fallo con codigo de salida $LASTEXITCODE."
  }

  Write-Host "Carga completada correctamente."
  Write-Host "Manzanas importadas: $($manzanas.Count)"
  Write-Host "Lotes importados: $($lotes.Count)"
}
finally {
  if ((Test-Path $tempSqlFile) -and -not $DryRun) {
    Remove-Item -Path $tempSqlFile -Force
  }
}