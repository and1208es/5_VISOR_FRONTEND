param(
  [string]$GeoServerUrl = "http://localhost:8080/geoserver",
  [string[]]$Layers = @("geoportal:capa_lotes", "geoportal:capa_manzanas"),
  [int]$SeedZoomStart = 12,
  [int]$SeedZoomStop = 18,
  [int]$ThreadCount = 2,
  [switch]$AutoDiscoverLayers
)

$ErrorActionPreference = "Stop"

function Normalize-GeoServerUrl {
  param(
    [Parameter(Mandatory = $true)] [string]$InputUrl
  )

  $url = $InputUrl.Trim()
  if ($url -notmatch "^https?://") {
    $url = "http://$url"
  }

  $url = $url.TrimEnd("/")

  try {
    $null = [System.Uri]$url
  }
  catch {
    throw "GeoServerUrl no es valido: $InputUrl"
  }

  return $url
}

function Get-SeedUri {
  param(
    [Parameter(Mandatory = $true)] [string]$LayerName,
    [Parameter(Mandatory = $true)] [string]$Extension
  )

  $encodedLayer = [System.Uri]::EscapeDataString($LayerName)
  return "$GeoServerUrl/gwc/rest/seed/$encodedLayer.$Extension"
}

function Get-CredentialFromInput {
  param(
    [string]$DefaultUser = "admin"
  )

  $user = Read-Host "Usuario GeoServer [$DefaultUser]"
  if ([string]::IsNullOrWhiteSpace($user)) {
    $user = $DefaultUser
  }

  $securePass = Read-Host "Password GeoServer" -AsSecureString
  return New-Object System.Management.Automation.PSCredential($user, $securePass)
}

function Invoke-SeedRequest {
  param(
    [Parameter(Mandatory = $true)] [string]$LayerName,
    [Parameter(Mandatory = $true)] [string]$Type,
    [Parameter(Mandatory = $true)] [int]$ZoomStart,
    [Parameter(Mandatory = $true)] [int]$ZoomStop,
    [Parameter(Mandatory = $true)] [System.Management.Automation.PSCredential]$Credential
  )

  $body = @"
<seedRequest>
  <name>$LayerName</name>
  <srs><number>3857</number></srs>
  <zoomStart>$ZoomStart</zoomStart>
  <zoomStop>$ZoomStop</zoomStop>
  <format>application/vnd.mapbox-vector-tile</format>
  <type>$Type</type>
  <threadCount>$ThreadCount</threadCount>
</seedRequest>
"@

  $uri = Get-SeedUri -LayerName $LayerName -Extension "xml"

  Invoke-RestMethod `
    -Uri $uri `
    -Method Post `
    -ContentType "text/xml" `
    -Body $body `
    -Credential $Credential | Out-Null
}

function Show-SeedStatus {
  param(
    [Parameter(Mandatory = $true)] [string]$LayerName,
    [Parameter(Mandatory = $true)] [System.Management.Automation.PSCredential]$Credential
  )

  $uri = Get-SeedUri -LayerName $LayerName -Extension "json"
  $response = Invoke-RestMethod -Uri $uri -Method Get -Credential $Credential
  $response | ConvertTo-Json -Depth 8
}

function Get-DiscoveredLayers {
  param(
    [Parameter(Mandatory = $true)] [System.Management.Automation.PSCredential]$Credential
  )

  $discovered = @()

  try {
    $uri = "$GeoServerUrl/gwc/rest/layers.json"
    $response = Invoke-RestMethod -Uri $uri -Method Get -Credential $Credential

    if ($response.layers -and $response.layers.layer) {
      foreach ($entry in @($response.layers.layer)) {
        if ($entry.name) {
          $discovered += [string]$entry.name
        }
      }
    }
  }
  catch {
    # Fallback a WMTS capabilities si GWC REST no esta disponible.
  }

  if ($discovered.Count -eq 0) {
    try {
      $wmtsUri = "$GeoServerUrl/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"
      $wmts = Invoke-WebRequest -Uri $wmtsUri -Method Get -Credential $Credential
      $matches = [regex]::Matches($wmts.Content, "<ows:Identifier>([^<]+)</ows:Identifier>")

      foreach ($m in $matches) {
        $value = $m.Groups[1].Value
        if ($value -match "^[A-Za-z0-9_\-]+:[A-Za-z0-9_\-]+$" -and $value -notlike "EPSG:*") {
          $discovered += $value
        }
      }
    }
    catch {
      # Si ambos metodos fallan, se mantiene la lista existente.
    }
  }

  $discovered = $discovered | Sort-Object -Unique
  return @($discovered)
}

function Get-LayerByIndex {
  param(
    [Parameter(Mandatory = $true)] [int]$MenuIndex
  )

  if ($MenuIndex -lt 1 -or $MenuIndex -gt $Layers.Count) {
    throw "Indice fuera de rango"
  }

  return $Layers[$MenuIndex - 1]
}

function Show-Layers {
  param(
    [Parameter(Mandatory = $true)] [string]$ActiveLayer
  )

  Write-Host "Capas configuradas:"
  for ($i = 0; $i -lt $Layers.Count; $i++) {
    $index = $i + 1
    $layer = $Layers[$i]
    $mark = " "
    if ($layer -eq $ActiveLayer) {
      $mark = "*"
    }
    Write-Host ("{0}) [{1}] {2}" -f $index, $mark, $layer)
  }
}

function Show-Menu {
  param(
    [Parameter(Mandatory = $true)] [string]$ActiveLayer
  )

  Write-Host ""
  Write-Host "GeoServer Cache Tool"
  Write-Host "Capa activa: $ActiveLayer"
  Write-Host "1) Truncate cache (0-24)"
  Write-Host "2) Seed cache ($SeedZoomStart-$SeedZoomStop)"
  Write-Host "3) Ver estado"
  Write-Host "4) Truncate + Seed"
  Write-Host "5) Cambiar capa activa"
  Write-Host "6) Listar capas configuradas"
  Write-Host "7) Recargar capas desde GeoServer"
  Write-Host "8) Truncate + Seed TODAS las capas"
  Write-Host "9) Truncate TODAS las capas"
  Write-Host "0) Salir"
  Write-Host ""
}

$credential = Get-CredentialFromInput
$GeoServerUrl = Normalize-GeoServerUrl -InputUrl $GeoServerUrl
$initialDiscoveredLayers = @()

if ($AutoDiscoverLayers) {
  $initialDiscoveredLayers = Get-DiscoveredLayers -Credential $credential
  if ($initialDiscoveredLayers.Count -gt 0) {
    $Layers = $initialDiscoveredLayers
    Write-Host "Capas cargadas desde GeoServer: $($Layers.Count)"
  }
  else {
    Write-Host "No se pudieron descubrir capas. Se usara la lista actual."
  }
}

if ($Layers.Count -eq 0) {
  throw "No hay capas configuradas. Usa -Layers o -AutoDiscoverLayers."
}

$activeLayer = $Layers[0]

while ($true) {
  Show-Menu -ActiveLayer $activeLayer
  $choice = Read-Host "Selecciona una opcion"

  try {
    switch ($choice) {
      "1" {
        Invoke-SeedRequest -LayerName $activeLayer -Type "truncate" -ZoomStart 0 -ZoomStop 24 -Credential $credential
        Write-Host "OK: cache truncada para $activeLayer"
      }
      "2" {
        Invoke-SeedRequest -LayerName $activeLayer -Type "seed" -ZoomStart $SeedZoomStart -ZoomStop $SeedZoomStop -Credential $credential
        Write-Host "OK: seed iniciado para $activeLayer (z$SeedZoomStart-z$SeedZoomStop)"
      }
      "3" {
        Write-Host "Estado actual ($activeLayer):"
        Show-SeedStatus -LayerName $activeLayer -Credential $credential
      }
      "4" {
        Invoke-SeedRequest -LayerName $activeLayer -Type "truncate" -ZoomStart 0 -ZoomStop 24 -Credential $credential
        Write-Host "OK: cache truncada"
        Invoke-SeedRequest -LayerName $activeLayer -Type "seed" -ZoomStart $SeedZoomStart -ZoomStop $SeedZoomStop -Credential $credential
        Write-Host "OK: seed iniciado para $activeLayer (z$SeedZoomStart-z$SeedZoomStop)"
      }
      "5" {
        Show-Layers -ActiveLayer $activeLayer
        $selectedIndex = Read-Host "Escribe el numero de la capa activa"
        $newLayer = Get-LayerByIndex -MenuIndex ([int]$selectedIndex)
        $activeLayer = $newLayer
        Write-Host "Capa activa cambiada a: $activeLayer"
      }
      "6" {
        Show-Layers -ActiveLayer $activeLayer
      }
      "7" {
        $newLayers = Get-DiscoveredLayers -Credential $credential
        if ($newLayers.Count -eq 0) {
          Write-Host "No se pudieron descubrir capas. Se mantiene la lista actual."
        }
        else {
          $Layers = $newLayers
          if ($Layers -notcontains $activeLayer) {
            $activeLayer = $Layers[0]
          }
          Write-Host "Capas recargadas: $($Layers.Count). Capa activa: $activeLayer"
        }
      }
      "8" {
        Write-Host "Iniciando Truncate + Seed para $($Layers.Count) capa(s)..."
        foreach ($layer in $Layers) {
          Write-Host "  -> Truncando: $layer"
          Invoke-SeedRequest -LayerName $layer -Type "truncate" -ZoomStart 0 -ZoomStop 24 -Credential $credential
          Write-Host "  -> Seed iniciado: $layer (z$SeedZoomStart-z$SeedZoomStop)"
          Invoke-SeedRequest -LayerName $layer -Type "seed" -ZoomStart $SeedZoomStart -ZoomStop $SeedZoomStop -Credential $credential
        }
        Write-Host "OK: Truncate + Seed enviado a todas las capas."
      }
      "9" {
        Write-Host "Truncando cache para $($Layers.Count) capa(s)..."
        foreach ($layer in $Layers) {
          Write-Host "  -> Truncando: $layer"
          Invoke-SeedRequest -LayerName $layer -Type "truncate" -ZoomStart 0 -ZoomStop 24 -Credential $credential
        }
        Write-Host "OK: Cache truncada para todas las capas."
      }
      "0" {
        Write-Host "Saliendo..."
        break
      }
      default {
        Write-Host "Opcion no valida"
      }
    }
  }
  catch {
    Write-Host "ERROR: $($_.Exception.Message)"
  }
}
