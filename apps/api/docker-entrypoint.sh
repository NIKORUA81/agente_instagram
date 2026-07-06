#!/bin/sh
# Entrypoint de la imagen del API.
# Aplica las migraciones de Prisma ANTES de arrancar el proceso, salvo que
# RUN_MIGRATIONS=false (útil para réplicas que no deban migrar).
# `prisma migrate deploy` es idempotente y usa un advisory lock, así que es
# seguro aunque varios contenedores arranquen a la vez.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "→ Aplicando migraciones de base de datos (prisma migrate deploy)..."
  ./node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma
  echo "→ Migraciones aplicadas."
else
  echo "→ RUN_MIGRATIONS=false: se omiten las migraciones."
fi

echo "→ Iniciando API (MODE=${MODE:-api})..."
exec "$@"
