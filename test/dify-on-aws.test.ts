import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';

test('Snapshot test', () => {
  const app = new cdk.App();
  const stack = new DifyOnAwsStack(app, 'TestStack', { allowedCidrs: ['0.0.0.0/0'] });
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});
