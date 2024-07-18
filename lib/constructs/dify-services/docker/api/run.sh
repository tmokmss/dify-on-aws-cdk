# we cannot use systems manager Lambda extension during initialization phase...
# wget "http://localhost:2773/systemsmanager/parameters/get?name=$CLOUDFRONT_URL_PARAMETER" -o /tmp/cf.txt
# URL=$(cat /tmp/cf.txt)

# To avoid from circular dependency, we get cloudfront domain on runtime
URL=$(python -c "import boto3;client = boto3.client('ssm');param=client.get_parameter(Name='$CLOUDFRONT_URL_PARAMETER');print(param['Parameter']['Value'])")
echo $URL

# The base URL of console application web frontend, refers to the Console base URL of WEB service if console domain is
# different from api or web app domain.
export CONSOLE_WEB_URL=$URL
# The base URL of console application api server, refers to the Console base URL of WEB service if console domain is different from api or web app domain.
export CONSOLE_API_URL=$URL
# The URL prefix for Service API endpoints, refers to the base URL of the current API service if api domain is different from console domain.
export SERVICE_API_URL=$URL
# The URL prefix for Web APP frontend, refers to the Web App base URL of WEB service if web app domain is different from console or api domain.
export APP_WEB_URL=$URL
exec /bin/bash /entrypoint.sh
