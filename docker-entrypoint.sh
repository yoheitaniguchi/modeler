#!/bin/sh
set -e

mkdir -p "${MODELER_DATA_DIR:-/app/data}"
mkdir -p "/app/log"

exec "$@"
