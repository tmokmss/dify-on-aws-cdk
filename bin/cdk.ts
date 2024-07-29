#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

const app = new cdk.App();

const virginia = new UsEast1Stack(app, 'DifyUsEast1Stack', {
  crossRegionReferences: true,
});

new DifyOnAwsStack(app, 'DifyOnAwsStack', {
  env: { region: 'ap-northeast-1' },
  crossRegionReferences: true,
  // Allow access from the Internet. Narrow this down if you want further security.
  allowedCidrs: ['0.0.0.0/0'],
  difyImageTag: '0.6.15',
  difySandboxImageTag: '0.2.4',
  usEast1Stack: virginia,
});
