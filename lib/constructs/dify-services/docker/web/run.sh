#!/bin/bash -x

[ ! -d '/tmp/cache' ] && mkdir -p /tmp/cache
[ ! -d '/tmp/.pm2' ] && mkdir -p /tmp/.pm2

exec /bin/sh ./entrypoint.sh
