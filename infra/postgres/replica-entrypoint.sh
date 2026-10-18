#!/bin/bash
# Read replica bootstrap: on first start, clone the primary with pg_basebackup
# (-R writes standby.signal + primary_conninfo), then start Postgres as a hot standby.
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo "[replica] data dir empty - cloning from ${PRIMARY_HOST}"
  until pg_isready -h "$PRIMARY_HOST" -p 5432 -q; do
    echo "[replica] waiting for ${PRIMARY_HOST}..."
    sleep 2
  done

  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"

  gosu postgres env PGPASSWORD="$REPLICATION_PASSWORD" \
    pg_basebackup -h "$PRIMARY_HOST" -p 5432 -U replicator \
                  -D "$PGDATA" -Fp -Xs -R -P
  echo "[replica] base backup complete"
fi

# A standby must have settings >= the primary's, or recovery aborts.
# Keep these in sync with the primary's command in docker-compose.yml.
exec docker-entrypoint.sh postgres \
  -c hot_standby=on \
  -c max_connections=200 \
  -c max_wal_senders=10 \
  -c max_worker_processes=8
