import { APIGatewayRequestAuthorizerHandler } from 'aws-lambda';

const allowedCidrs = (process.env.ALLOWED_CIDRS ?? '0.0.0.0/0').split(',');

export const handler: APIGatewayRequestAuthorizerHandler = async (event, context) => {
  const response = {
    principalId: 'any',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'execute-api:Invoke',
          Resource: event.methodArn,
          Condition: {
            IpAddress: {
              'aws:SourceIp': allowedCidrs,
            },
          },
        },
      ],
    },
  };
  return response;
};
