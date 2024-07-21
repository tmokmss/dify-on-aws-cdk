ARG DIFY_VERSION=latest
FROM langgenius/dify-api:${DIFY_VERSION}
# COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.3 /lambda-adapter /opt/extensions/lambda-adapter
COPY ./extensions /opt/extensions
# https://github.com/awslabs/aws-lambda-web-adapter?tab=readme-ov-file#configurations
ENV AWS_LWA_PORT 5001
ENV AWS_LWA_INVOKE_MODE response_stream
# ENV RUST_LOG=debug
RUN python -m compileall -f -j 0 -q ./ || true
# RUN (python -m compileall -f -j 0 -q ./ || true) && (python -m compileall -j 0 -f -q /usr/local/lib/ || true)
COPY run.sh ./run.sh
ENTRYPOINT ["/bin/bash", "./run.sh"]
