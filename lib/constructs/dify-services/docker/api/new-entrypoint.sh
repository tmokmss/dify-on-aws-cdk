exec /bin/bash /entrypoint.sh
# exec gunicorn \
#     --bind "${DIFY_BIND_ADDRESS:-0.0.0.0}:${DIFY_PORT:-5001}" \
#     --workers ${SERVER_WORKER_AMOUNT:-1} \
#     --worker-class ${SERVER_WORKER_CLASS:-gevent} \
#     --timeout ${GUNICORN_TIMEOUT:-200} \
#     --preload \
#     app:app
# flask run --host=${DIFY_BIND_ADDRESS:-0.0.0.0} --port=${DIFY_PORT:-5001}
