import type { CloudFrontRequestHandler } from 'aws-lambda';

const hashPayload = async (payload: Buffer) => {
  const hash = await crypto.subtle.digest('SHA-256', payload);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((bytes) => bytes.toString(16).padStart(2, '0')).join('');
};

export const handler: CloudFrontRequestHandler = async (event) => {
  const request = event.Records[0].cf.request;
  console.debug('request=' + JSON.stringify(request));

  const body = request.body?.data ?? '';
  const hashedBody = await hashPayload(Buffer.from(body, 'base64'));

  request.headers['x-amz-content-sha256'] = [{ key: 'x-amz-content-sha256', value: hashedBody }];

  // LWA replaces authorization2 to authorization again
  if (request.headers['authorization'] != null) {
    request.headers['authorization2'] = [{ key: 'authorization2', value: request.headers['authorization'][0].value }];
    delete request.headers['authorization'];
  }

  if (request.uri.startsWith('/DIFY_SANDBOX')) {
    request.uri = request.uri.replace('/DIFY_SANDBOX', '');
  }

  return request;
};
