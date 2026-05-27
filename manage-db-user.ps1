param(
  [string]$Username,
  [string]$Password,
  [ValidateSet("editor", "readonly")] [string]$RoleType = "editor",
  [string]$DbContainer = "geoportal_db",
  [string]$DbName,
  [string]$AdminUser,
  [string]$AdminPassword,
  [switch]$ApplyPermissionsModel,
  [switch]$ListUsers,
  [switch]$DisableUser,
  [switch]$DeleteUser
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

function Test-SafeRoleName {
  param([string]$RoleName)
  return $RoleName -match '^[A-Za-z_][A-Za-z0-9_]{0,62}$'
}

function Convert-ToSqlLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Invoke-DbSql {
  param(
    [string]$Sql,
    [string]$Container,
    [string]$Database,
    [string]$User,
    [string]$PasswordText
  )

  $Sql | & docker exec -i -e "PGPASSWORD=$PasswordText" $Container psql -v ON_ERROR_STOP=1 -U $User -d $Database

  if ($LASTEXITCODE -ne 0) {
    throw "La operacion SQL fallo con codigo de salida $LASTEXITCODE."
  }
}

$envMap = Read-DotEnv -Path ".env"

if (-not $DbName -and $envMap.ContainsKey("POSTGRES_DB")) { $DbName = $envMap["POSTGRES_DB"] }
if (-not $AdminUser -and $envMap.ContainsKey("POSTGRES_USER")) { $AdminUser = $envMap["POSTGRES_USER"] }
if (-not $AdminPassword -and $envMap.ContainsKey("POSTGRES_PASSWORD")) { $AdminPassword = $envMap["POSTGRES_PASSWORD"] }

if (-not $DbName -or -not $AdminUser -or -not $AdminPassword) {
  throw "Faltan credenciales administrativas. Define POSTGRES_DB, POSTGRES_USER y POSTGRES_PASSWORD en .env o por parametros."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker no esta disponible en el sistema."
}

if (($DisableUser -or $DeleteUser) -and [string]::IsNullOrWhiteSpace($Username)) {
  throw "Debes indicar -Username para desactivar o eliminar un usuario."
}

if (-not $ListUsers -and -not $DisableUser -and -not $DeleteUser) {
  if ([string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
    throw "Debes indicar -Username y -Password para crear o actualizar un usuario."
  }
}

if (-not $ListUsers -and -not [string]::IsNullOrWhiteSpace($Username) -and -not (Test-SafeRoleName -RoleName $Username)) {
  throw "El nombre de usuario solo puede contener letras, numeros y guion bajo, y debe empezar con letra o guion bajo."
}

if ($ListUsers) {
  $listSql = @"
SELECT
  r.rolname AS username,
  CASE
    WHEN pg_has_role(r.rolname, 'geoportal_editor', 'member') THEN 'editor'
    WHEN pg_has_role(r.rolname, 'geoportal_readonly', 'member') THEN 'readonly'
    ELSE 'none'
  END AS role_type
FROM pg_roles r
WHERE r.rolcanlogin = true
  AND (
    pg_has_role(r.rolname, 'geoportal_editor', 'member')
    OR pg_has_role(r.rolname, 'geoportal_readonly', 'member')
  )
ORDER BY r.rolname;
"@
  Invoke-DbSql -Sql $listSql -Container $DbContainer -Database $DbName -User $AdminUser -PasswordText $AdminPassword
  return
}

if ($ApplyPermissionsModel) {
  $permissionsSql = Get-Content -Raw .\deploy\postgis\init\003_geoportal_permissions.sql
  Invoke-DbSql -Sql $permissionsSql -Container $DbContainer -Database $DbName -User $AdminUser -PasswordText $AdminPassword
}

if ($DisableUser) {
  $disableUserSql = @'
ALTER ROLE "{0}" NOLOGIN;
REVOKE "geoportal_editor" FROM "{0}";
REVOKE "geoportal_readonly" FROM "{0}";
'@ -f $Username

  Invoke-DbSql -Sql $disableUserSql -Container $DbContainer -Database $DbName -User $AdminUser -PasswordText $AdminPassword
  Write-Host "Usuario desactivado correctamente."
  Write-Host "Usuario: $Username"
  return
}

if ($DeleteUser) {
  $deleteUserSql = @'
DROP OWNED BY "{0}";
DROP ROLE IF EXISTS "{0}";
'@ -f $Username

  Invoke-DbSql -Sql $deleteUserSql -Container $DbContainer -Database $DbName -User $AdminUser -PasswordText $AdminPassword
  Write-Host "Usuario eliminado correctamente."
  Write-Host "Usuario: $Username"
  return
}

$groupRole = if ($RoleType -eq "editor") { "geoportal_editor" } else { "geoportal_readonly" }
$otherGroupRole = if ($RoleType -eq "editor") { "geoportal_readonly" } else { "geoportal_editor" }

$createUserSql = @'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{0}') THEN
    EXECUTE 'CREATE ROLE "{0}" LOGIN PASSWORD ' || quote_literal('{1}');
  ELSE
    EXECUTE 'ALTER ROLE "{0}" LOGIN PASSWORD ' || quote_literal('{1}');
  END IF;
END
$$;

GRANT CONNECT ON DATABASE "{2}" TO "{0}";
GRANT USAGE ON SCHEMA geoportal TO "{0}";
REVOKE "{3}" FROM "{0}";
GRANT "{4}" TO "{0}";
'@ -f $Username, $Password, $DbName, $otherGroupRole, $groupRole

Invoke-DbSql -Sql $createUserSql -Container $DbContainer -Database $DbName -User $AdminUser -PasswordText $AdminPassword

Write-Host "Usuario creado o actualizado correctamente."
Write-Host "Usuario: $Username"
Write-Host "Rol: $RoleType"
Write-Host "Base: $DbName"