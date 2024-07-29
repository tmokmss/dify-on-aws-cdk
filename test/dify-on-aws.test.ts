import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

test('Snapshot test (us-east-1)', () => {
  const app = new cdk.App();

  const stack = new UsEast1Stack(app, 'UsEast1TestStack', { env: { region: 'us-east-1' } });
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});

test('Snapshot test', () => {
  const app = new cdk.App();

  const usEast1Stack = new UsEast1Stack(app, 'UsEast1TestStack', {
    crossRegionReferences: true,
    env: { region: 'us-east-1' },
  });
  const stack = new DifyOnAwsStack(app, 'TestStack', {
    env: { region: 'ap-northeast-1' },
    crossRegionReferences: true,
    allowedCidrs: ['0.0.0.0/0'],
    difySandboxImageTag: '0.2.4',
    difyImageTag: '0.6.15',
    usEast1Stack,
  });
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});
