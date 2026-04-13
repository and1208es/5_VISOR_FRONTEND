#!/bin/bash
# deploy-vps.sh — Despliegue inicial en VPS (Ubuntu 22.04 / 24.04)
# Uso: bash deploy-vps.sh tudominio.com tu@email.com
set -euo pipefail

DOMAIN="${1:?Uso: bash deploy-vps.sh tudominio.com tu@email.com}"
EMAIL="${2:?Uso: bash deploy-vps.sh tudominio.com tu@email.com}"
REPO="https://github.com/and1208es/5_VISOR_FRONTEND.git"
APP_DIR="/opt/geoportal"

echo "==> [1/6] Actualizando sistema e instalando dependencias..."
apt-get update -qq
apt-get install -y -qq git curl docker.io docker-compose-plugin ufw

echo "==> [2/6] Habilitando Docker..."
systemctl enable --now docker

echo "==> [3/6] Clonando repositorio en $APP_DIR..."
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  git pull
else
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> [4/6] Configurando variables de entorno..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  AVISO: Se creo .env desde .env.example."
  echo "  Edita $APP_DIR/.env con tus claves reales y luego ejecuta:"
  echo "    DOMAIN=$DOMAIN bash deploy-vps.sh $DOMAIN $EMAIL"
  echo ""
  read -rp "  Presiona Enter para abrir el editor ahora, o Ctrl+C para cancelar: "
  nano .env
fi

echo "  Agregando DOMAIN al .env..."
grep -q "^DOMAIN=" .env && sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env || echo "DOMAIN=$DOMAIN" >> .env

echo "==> [5/6] Obteniendo certificado SSL (Let's Encrypt)..."
# Primer arranque en modo bootstrap HTTP para que certbot valide el dominio
docker compose -f docker-compose.prod.yml up -d db geoserver web

echo "  Esperando a que nginx este listo..."
sleep 5

docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

echo "==> [6/6] Levantando stack completo con HTTPS..."
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "=============================================="
echo "  Geoportal publicado en https://$DOMAIN"
echo "  GeoServer admin: https://$DOMAIN/geoserver"
echo "=============================================="
