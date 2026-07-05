-- Rol de aplicación sin superusuario: dueño de la BD (puede correr migraciones)
-- pero sujeto a FORCE ROW LEVEL SECURITY en tiempo de ejecución.
-- CREATEDB permite a `prisma migrate dev` crear su shadow database.
CREATE ROLE wolfiax LOGIN PASSWORD 'wolfiax_dev' NOSUPERUSER CREATEDB;
CREATE DATABASE wolfiax OWNER wolfiax;
\connect wolfiax
CREATE EXTENSION IF NOT EXISTS vector;
