#!/bin/bash -x

# [ ! -d '/tmp/logs' ] && mkdir -p /tmp/logs
cp /main /tmp/main
cd /tmp
exec ./main
# exec /main
