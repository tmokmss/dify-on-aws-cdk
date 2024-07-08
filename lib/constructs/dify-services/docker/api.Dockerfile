ARG DIFY_VERSION=latest
FROM langgenius/dify-api:${DIFY_VERSION}
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.3 /lambda-adapter /opt/extensions/lambda-adapter
# https://github.com/awslabs/aws-lambda-web-adapter?tab=readme-ov-file#configurations
ENV AWS_LWA_PORT 5001
RUN ln -s /tmp/cache ./.cache
RUN ln -s /tmp/config ./.config
