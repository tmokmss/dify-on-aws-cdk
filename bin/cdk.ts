#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DifyOnAwsCdkStack } from '../lib/dify-on-aws-cdk-stack';

const app = new cdk.App();
new DifyOnAwsCdkStack(app, 'DifyOnAwsCdkStack', {
  env: { region: 'us-east-1' },
  allowedCidrs: ['0.0.0.0/32'],
});
