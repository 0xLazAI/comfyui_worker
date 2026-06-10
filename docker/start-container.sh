#!/bin/sh
set -eu

/usr/bin/supervisord -c /etc/supervisor/conf.d/worker.conf

exec /usr/local/bin/start-service.sh
