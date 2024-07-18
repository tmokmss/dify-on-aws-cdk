ARG DIFY_VERSION=latest
FROM langgenius/dify-web:${DIFY_VERSION}
# COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.3 /lambda-adapter /opt/extensions/lambda-adapter
COPY ./lambda-adapter /opt/extensions/lambda-adapter
# https://github.com/awslabs/aws-lambda-web-adapter?tab=readme-ov-file#configurations
ENV AWS_LWA_PORT 3000
# ENV RUST_LOG=debug

COPY ./run.sh ./
RUN ln -s /tmp/cache ./.next/cache
RUN ln -s /tmp/.pm2 /etc/.pm2

ENTRYPOINT ["sh", "run.sh"]
