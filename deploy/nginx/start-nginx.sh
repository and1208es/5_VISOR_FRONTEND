#!/bin/sh
set -eu

DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  echo "ERROR: DOMAIN no esta definido."
  exit 1
fi

TEMPLATE_DIR="/etc/nginx/custom-templates"
OUTPUT_CONF="/etc/nginx/conf.d/default.conf"
CERT_FILE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [ -f "$CERT_FILE" ]; then
  envsubst '${DOMAIN}' < "${TEMPLATE_DIR}/prod.conf.template" > "$OUTPUT_CONF"
  echo "INFO: Configurando Nginx en modo HTTPS para ${DOMAIN}."
else
  cp "${TEMPLATE_DIR}/bootstrap.conf.template" "$OUTPUT_CONF"
  echo "INFO: Certificado no encontrado. Iniciando Nginx en modo HTTP bootstrap."
fi

exec nginx -g 'daemon off;'
