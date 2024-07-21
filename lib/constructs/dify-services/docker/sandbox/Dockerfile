ARG DIFY_VERSION=latest
FROM langgenius/dify-sandbox:${DIFY_VERSION}
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.3 /lambda-adapter /opt/extensions/lambda-adapter
# https://github.com/awslabs/aws-lambda-web-adapter?tab=readme-ov-file#configurations
ENV AWS_LWA_PORT 8194
ENV AWS_LWA_READINESS_CHECK_PROTOCOL tcp
# RUN ln -s /tmp/logs /logs
COPY ./run.sh /
COPY ./sandbox-python-requirements.txt /dependencies/python-requirements.txt

ENTRYPOINT ["sh", "/run.sh"]
