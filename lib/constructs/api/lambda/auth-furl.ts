import type { CloudFrontRequestHandler } from 'aws-lambda';
import { createHash } from 'crypto';

const hashPayload = (payload: Buffer) => {
  return createHash('sha256').update(payload).digest('hex');
};

export const handler: CloudFrontRequestHandler = async (event) => {
  const request = event.Records[0].cf.request;
  const body = request.body?.data ?? '';

  if (request.body) {
    request.body.data = body.slice(0, 100);
    console.debug(`size of the body: ${body.length}`)
  }
  console.debug('request=' + JSON.stringify(request));

  const hashedBody = hashPayload(Buffer.from(body, 'base64'));

  request.headers['x-amz-content-sha256'] = [{ key: 'x-amz-content-sha256', value: hashedBody }];
  console.debug(hashedBody);

  // LWA replaces authorization2 to authorization again
  if (request.headers['authorization'] != null) {
    request.headers['authorization2'] = [{ key: 'authorization2', value: request.headers['authorization'][0].value }];
    delete request.headers['authorization'];
  }

  if (request.body) {
    request.body.data = body;
  }

  return request;
};
