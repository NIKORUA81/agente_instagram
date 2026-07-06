# 10 — Despliegue en tu VPS (Portainer + Postgres + PgAdmin existentes)

> Guía operativa para subir WOLFIAX SOCIAL AI al VPS que ya tienes montado.
> Se ejecuta cuando decidas publicar; no bloquea el desarrollo local.

## 0. Qué ya tienes y qué falta

| Pieza | Estado | Acción |
|---|---|---|
| Docker + Portainer | ✅ ya montado | Se usa para desplegar los stacks |
| PostgreSQL | ✅ ya montado | Prepararlo (rol, BD, **pgvector**) — §2 |
| PgAdmin | ✅ ya montado | Se usa para ejecutar el SQL de §2 |
| Redis | ❌ | Stack nuevo — §3 |
| Reverse proxy con TLS | ❓ | Si no tienes uno, stack de Traefik — §4 |
| Imágenes de la app | ❌ | Build & push a GHCR — §5 |
| Stack de la app (web+api) | ❌ | Compose para Portainer — §6 |

**Requisitos previos:**
- Dos subdominios apuntando (registros A) a la IP del VPS: `app.tudominio.com` y `api.tudominio.com`.
- Puertos 80/443 abiertos; **Postgres (5432), Redis (6379), Portainer y PgAdmin NUNCA expuestos a internet** (si hoy lo están, ciérralos con el firewall del proveedor o UFW y accede por VPN/túnel SSH).
- Cuenta de GitHub con el repo subido (para GHCR y CI/CD).

---

## 1. Verificación crítica: ¿tu Postgres soporta pgvector?

La plataforma requiere la extensión `vector` (RAG en F3) y **Postgres 16+**. En PgAdmin ejecuta:

```sql
SELECT version();
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```

- Si `vector` aparece → continúa a §2.
- Si NO aparece: tu contenedor de Postgres no trae pgvector. Dos opciones:
  - **Opción A (recomendada):** cambia la imagen del contenedor a `pgvector/pgvector:pg16` (misma familia que Postgres oficial; conserva el volumen de datos si la versión mayor coincide — haz backup antes con `pg_dumpall`).
  - **Opción B:** instala el paquete dentro del contenedor actual (se pierde al recrear el contenedor, no recomendado).

## 2. Preparar Postgres (PgAdmin)

El rol de la aplicación **no debe ser superusuario**: el aislamiento multi-tenant depende de que Row-Level Security se aplique (los superusuarios se saltan RLS). Ejecuta como `postgres`:

```sql
-- 1. Rol de aplicación (elige una contraseña fuerte y guárdala en un gestor)
CREATE ROLE wolfiax LOGIN PASSWORD 'Administrador2026' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- 2. Base de datos propiedad del rol (owner ⇒ puede correr migraciones,
--    pero FORCE ROW LEVEL SECURITY le aplica igual las políticas)
CREATE DATABASE wolfiax_db OWNER wolfiax;
```

> Nombre de la BD: en este despliegue la base se llama **`wolfiax_db`** (así aparece en PgAdmin). Usa ese nombre de forma consistente en el `DATABASE_URL` (§6). Si en algún paso ves `wolfiax` a secas como nombre de BD, cámbialo por `wolfiax_db`.

Conéctate ahora a la BD `wolfiax_db` (no a `postgres`) y ejecuta:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Verificación de seguridad (debe devolver `f` en ambas columnas):

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'wolfiax';
```

> **⚠️ Percent-encoding de la contraseña en el `DATABASE_URL`.**
> La contraseña viaja dentro de una URL, así que los caracteres reservados
> (`@ : / ? # [ ] % & + espacio`) **deben ir codificados**. La contraseña de
> este despliegue, `Administrador2026`, es **solo alfanumérica → NO requiere
> codificación**, se pega tal cual. Pero si algún día la cambias por una con
> símbolos, codifícala: por ejemplo `P@ss/w0rd+` se escribiría
> `P%40ss%2Fw0rd%2B` (`@`→`%40`, `/`→`%2F`, `+`→`%2B`). Un error de encoding
> se manifiesta como `P1000 Authentication failed`.

**Red:** el contenedor de la app debe alcanzar a Postgres. Si tu Postgres está en una red Docker (p. ej. la de Portainer), anota el nombre de esa red y el nombre del contenedor; la `DATABASE_URL` usará `postgresql://wolfiax:Administrador2026@<nombre-contenedor-postgres>:5432/wolfiax_db` y el stack de la app se unirá a esa red externa (§6).

## 3. Redis (stack nuevo en Portainer)

Portainer → Stacks → Add stack → `wolfiax-redis`:

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec",
              "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redis_data:/data
    networks:
      - wolfiax
volumes:
  redis_data:
networks:
  wolfiax:
    external: true
```

Antes crea la red compartida (una sola vez, en la consola del VPS o Portainer → Networks):
`docker network create wolfiax`
Define `REDIS_PASSWORD` en las variables del stack de Portainer.

## 4. Reverse proxy con TLS

**Si ya tienes proxy** (Nginx Proxy Manager, Caddy, Traefik): crea dos hosts → `app.tudominio.com` → `wolfiax-web:3000` y `api.tudominio.com` → `wolfiax-api:4000`, con certificados Let's Encrypt y **WebSockets habilitados en el host de la API** (imprescindible para el inbox en tiempo real). Conecta el proxy a la red `wolfiax`.

**Si no tienes proxy**, stack `traefik`:

```yaml
services:
  traefik:
    image: traefik:v3.3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=wolfiax
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
    ports: ["80:80", "443:443"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_acme:/letsencrypt
    networks: [wolfiax]
volumes:
  traefik_acme:
networks:
  wolfiax:
    external: true
```

## 5. Imágenes: build & push a GHCR

Los Dockerfiles ya existen en `infra/docker/`. Camino recomendado — workflow de GitHub Actions (crear `.github/workflows/deploy.yml` cuando llegue el momento; hace build en cada tag `v*` y push a `ghcr.io/<tu-usuario>/wolfiax-api|web`). Camino manual mientras tanto, desde tu PC:

```bash
docker login ghcr.io -u TU_USUARIO   # con un Personal Access Token (packages:write)

docker build -f infra/docker/api.Dockerfile -t ghcr.io/TU_USUARIO/wolfiax-api:latest .
docker build -f infra/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.tudominio.com \
  -t ghcr.io/TU_USUARIO/wolfiax-web:latest .

docker push ghcr.io/TU_USUARIO/wolfiax-api:latest
docker push ghcr.io/TU_USUARIO/wolfiax-web:latest
```

> ⚠️ `NEXT_PUBLIC_API_URL` se hornea en el build del web: si cambias de dominio, reconstruye la imagen web.
> En Portainer: Registries → Add registry → ghcr.io con tu usuario/token para poder hacer pull de imágenes privadas.

## 6. Stack de la aplicación en Portainer

Stacks → Add stack → `wolfiax-app`. Con Traefik del §4 (si usas NPM, quita los `labels` y publica los hosts desde NPM):

```yaml
services:
  api:
    image: ghcr.io/TU_USUARIO/wolfiax-api:latest
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "4000"
      MODE: api
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      WEB_ORIGIN: https://app.tudominio.com
      API_PUBLIC_URL: https://api.tudominio.com
      COOKIE_SECURE: "true"
      JWT_PRIVATE_KEY_BASE64: ${JWT_PRIVATE_KEY_BASE64}
      JWT_PUBLIC_KEY_BASE64: ${JWT_PUBLIC_KEY_BASE64}
      TOKEN_ENC_KEY_BASE64: ${TOKEN_ENC_KEY_BASE64}
      META_GRAPH_VERSION: v23.0
      META_APP_ID: ${META_APP_ID}
      META_APP_SECRET: ${META_APP_SECRET}
      META_IG_APP_ID: ${META_IG_APP_ID}
      META_IG_APP_SECRET: ${META_IG_APP_SECRET}
      META_WEBHOOK_VERIFY_TOKEN: ${META_WEBHOOK_VERIFY_TOKEN}
      SWAGGER_ENABLED: "false"
    networks: [wolfiax]
    labels:
      - traefik.enable=true
      - traefik.http.routers.wolfiax-api.rule=Host(`api.tudominio.com`)
      - traefik.http.routers.wolfiax-api.entrypoints=websecure
      - traefik.http.routers.wolfiax-api.tls.certresolver=le
      - traefik.http.services.wolfiax-api.loadbalancer.server.port=4000

  web:
    image: ghcr.io/TU_USUARIO/wolfiax-web:latest
    restart: unless-stopped
    networks: [wolfiax]
    labels:
      - traefik.enable=true
      - traefik.http.routers.wolfiax-web.rule=Host(`app.tudominio.com`)
      - traefik.http.routers.wolfiax-web.entrypoints=websecure
      - traefik.http.routers.wolfiax-web.tls.certresolver=le
      - traefik.http.services.wolfiax-web.loadbalancer.server.port=3000

networks:
  wolfiax:
    external: true
```

**Variables del stack** (pestaña Environment variables de Portainer):

| Variable | Cómo obtenerla |
|---|---|
| `DATABASE_URL` | `postgresql://wolfiax:Administrador2026@<contenedor-postgres>:5432/wolfiax_db?schema=public` (§2). Nombre de BD `wolfiax_db`. Si Postgres está en OTRA red Docker, añade esa red al servicio api también. |
| `REDIS_URL` | `redis://:REDIS_PASSWORD@redis:6379` (§3) |
| `JWT_PRIVATE/PUBLIC_KEY_BASE64`, `TOKEN_ENC_KEY_BASE64`, `META_WEBHOOK_VERIFY_TOKEN` | En tu PC: `node infra/scripts/generate-jwt-keys.mjs` → **claves DISTINTAS a las de desarrollo** |
| `META_*` | Panel de developers.facebook.com (§8) |
| `AI_SERVICE_URL` | `http://wolfiax-ai-service:5000` (nombre del contenedor del ai-service en la red `wolfiax`) |
| `AI_SERVICE_TOKEN` | Un valor aleatorio; el MISMO en `INTERNAL_API_TOKEN` del stack del ai-service (§6b) |

### 6b. Stack del ai-service (F3 — motor de IA)

Otro servicio en el stack (o un stack aparte) en la red `wolfiax`. Imagen
`ghcr.io/TU_USUARIO/wolfiax-ai-service:latest` (la construye tu workflow de GHCR).

```yaml
  ai-service:
    image: ghcr.io/nikorua81/wolfiax-ai-service:latest
    restart: unless-stopped
    environment:
      ENVIRONMENT: production
      PORT: "5000"
      DATABASE_URL: ${DATABASE_URL}          # la MISMA que el api (wolfiax_db)
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY} # clave secreta sk-ant-api03-...
      INTERNAL_API_TOKEN: ${AI_SERVICE_TOKEN} # igual que AI_SERVICE_TOKEN del api
      LLM_MODEL: claude-opus-4-8
    networks: [wolfiax]
    # No se expone al exterior: solo lo llama el api por la red interna.
```

Notas:
- **`ANTHROPIC_API_KEY`** es la clave secreta (`sk-ant-api03-…`) que se muestra
  UNA vez al crearla en console.anthropic.com, **no** el JSON de metadata.
- En el **primer arranque** descarga el modelo de embeddings (~1 GB, ONNX);
  puede tardar 1-2 min hasta que `/healthz` responda `ok`. Dale RAM (≥1.5 GB).
- No publica puertos: el api lo alcanza en `http://wolfiax-ai-service:5000`.
- Verificación: `docker exec wolfiax-ai-service curl -fsS http://localhost:5000/healthz`
  debe dar `{"status":"ok","db":"ok","llm_configured":true}`.

## 7. Migraciones de base de datos

**La imagen aplica las migraciones automáticamente al arrancar** (entrypoint
`docker-entrypoint.sh` → `prisma migrate deploy` → arranca el API). No tienes
que hacer nada manual: cada vez que redespliegas una versión con migraciones
nuevas, se aplican solas antes de que el API empiece a escuchar. Si la BD no
está lista, el contenedor sale con error y `restart: unless-stopped` reintenta.

> Puedes desactivar la auto-migración en un contenedor concreto (p. ej. una
> futura réplica de solo-worker) poniendo la variable `RUN_MIGRATIONS=false`.

Para verlo, en Portainer → contenedor `api` → **Logs** debe aparecer al inicio
algo como `Aplicando migraciones…` seguido de las migraciones aplicadas
(`init_iam`, `channels_inbox`, `inbox_tools_automations`).

Verificación en PgAdmin de que el RLS está activo (deben devolver ambas `t`):

```sql
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'conversations';
```

### Super Admin de plataforma (staff Wolfiax)

Para crear el primer Super Admin, añade estas variables al stack `wolfiax-app`
(servicio `api`) y redespliega — el API lo crea/promueve al arrancar:

```
SUPERADMIN_EMAIL=admin@wolfiax.com
SUPERADMIN_PASSWORD=<contraseña fuerte, mínimo 10 caracteres>
SUPERADMIN_NAME=Wolfiax Super Admin
```

- Si el email no existe → crea el usuario + una organización personal
  «Wolfiax Platform» (para poder iniciar sesión con el flujo normal).
- Si ya existe → lo promueve a Super Admin y actualiza su contraseña con la
  del entorno (cuenta de emergencia gobernada por las env del stack).

Es idempotente: seguro en cada reinicio. Tras el primer arranque puedes
**quitar `SUPERADMIN_PASSWORD`** del stack (el usuario ya existe) y gestionar el
resto de Super Admins desde el panel **Plataforma** de la app. El Super Admin
puede entrar a cualquier organización (impersonación) y suspender tenants; todo
queda en la tabla `audit_logs`.

### Alternativa manual de migraciones (sin redesplegar)

Si necesitas correr migraciones sin reconstruir la imagen, desde la consola del
contenedor `api` (`/bin/sh`, en `/app`):

```sh
corepack pnpm dlx prisma@6.19.3 migrate deploy --schema=prisma/schema.prisma
```

(Requiere salida a internet del contenedor para descargar la CLI temporalmente.)

## 8. Configurar la app de Meta para producción

En developers.facebook.com → tu app:

1. **OAuth redirect URIs** (en Facebook Login for Business y/o en Instagram API setup):
   `https://api.tudominio.com/api/v1/channels/instagram/callback`
2. **Webhooks** → producto Instagram → Callback URL:
   `https://api.tudominio.com/api/v1/webhooks/meta`
   Verify token: el MISMO valor de `META_WEBHOOK_VERIFY_TOKEN` del stack. Suscribe los campos `messages`, `messaging_postbacks`, `message_reactions`.
3. Mientras la app esté **en modo desarrollo** solo funcionan cuentas con rol en la app (admin/tester) — suficiente para probar. El App Review se tramita en F3 (ver docs/01 §3).

## 9. Smoke tests

```bash
curl https://api.tudominio.com/healthz          # → {"status":"ok","db":"ok",...}
# En el navegador: https://app.tudominio.com → registrarse → dashboard
# Conectar Instagram desde Canales → enviar un DM de prueba → aparece en el Inbox
```

Si el inbox no actualiza en vivo: revisa que el proxy tenga WebSockets habilitados hacia la API (error típico con NPM: activar "Websockets Support" en el host).

## 10. Backups (mínimo viable desde el día 1)

Cron en el VPS (ajusta contenedor/carpeta):

```bash
# /etc/cron.d/wolfiax-backup — diario 04:00, retiene 14 días
0 4 * * * root docker exec <contenedor-postgres> pg_dump -U wolfiax -Fc wolfiax \
  > /backups/wolfiax-$(date +\%F).dump && find /backups -name 'wolfiax-*.dump' -mtime +14 -delete
```

Copia `/backups` fuera del VPS (rclone a R2/Drive). Restauración: `pg_restore -U wolfiax -d wolfiax --clean archivo.dump`. Cuando haya clientes reales: migrar a pgBackRest con WAL (PITR, doc 08). **Prueba una restauración antes de tener usuarios.**

## 11. Actualizaciones

1. Push de código → build & push de imágenes (manual o Actions).
2. Portainer → stack `wolfiax-app` → **Re-pull image and redeploy**.
3. Si la versión trae migraciones: paso §7.
4. Rollback = redeploy con el tag anterior de la imagen (usa tags versionados `v0.2.0`, no solo `latest`, en cuanto haya usuarios).

## 12. Endurecimiento del VPS (checklist)

- [ ] UFW: permitir solo 22 (idealmente con IP restringida), 80, 443.
- [ ] Portainer y PgAdmin NO públicos (VPN, túnel SSH `ssh -L`, o allowlist de IP + 2FA).
- [ ] Postgres y Redis sin `ports:` publicados (solo redes Docker internas).
- [ ] Fail2ban para SSH; login por clave, sin password.
- [ ] Actualizaciones automáticas de seguridad del SO (`unattended-upgrades`).
- [ ] Los secretos solo viven en las variables del stack de Portainer (nunca en el repo).
