#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';

const app = new cdk.App();
new DifyOnAwsStack(app, 'DifyOnAwsStack', {
  env: { region: 'ap-northeast-1' },
  allowedCidrs: ['0.0.0.0/32'],
});
