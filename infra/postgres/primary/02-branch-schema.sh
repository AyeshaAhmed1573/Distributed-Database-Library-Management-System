#!/bin/bash
# Applies the shared branch schema. BRANCH_CODE / BRANCH_NAME come from docker-compose.
set -e

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v branch_code="$BRANCH_CODE" \
     -v branch_name="$BRANCH_NAME" \
     -f /schema/branch_schema.sql
