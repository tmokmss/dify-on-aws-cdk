ARG DIFY_VERSION=latest
FROM langgenius/dify-api:${DIFY_VERSION}
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.3 /lambda-adapter /opt/extensions/lambda-adapter
# https://github.com/awslabs/aws-lambda-web-adapter?tab=readme-ov-file#configurations
ENV AWS_LWA_PORT 5001
RUN python -m compileall -f -j 0 -q ./ || true
# RUN (python -m compileall -f -j 0 -q ./ || true) && (python -m compileall -j 0 -f -q /usr/local/lib/ || true)
# RUN flask run --port=5001 & pid=$! && sleep 60 && kill $pid

COPY ./new-entrypoint.sh /new-entrypoint.sh
ENTRYPOINT ["/bin/bash", "/new-entrypoint.sh"]
