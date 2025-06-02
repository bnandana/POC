import {
  SFNClient,
  CreateStateMachineCommand,
  ListStateMachinesCommand,
  DeleteStateMachineCommand,
  DescribeStateMachineCommand,
  UpdateStateMachineCommand
} from '@aws-sdk/client-sfn';
import {
  LambdaClient,
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  AddPermissionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand
} from '@aws-sdk/client-lambda';
import {
  IAMClient,
  CreateRoleCommand,
  DeleteRoleCommand,
  AttachRolePolicyCommand,
  DetachRolePolicyCommand,
  ListAttachedRolePoliciesCommand,
  GetRoleCommand,
  PutRolePolicyCommand
} from '@aws-sdk/client-iam';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketNotificationConfigurationCommand,
  HeadBucketCommand,
  BucketLocationConstraint
} from '@aws-sdk/client-s3';
// import {
//   EventBridgeClient,
//   PutRuleCommand,
//   PutTargetsCommand
// } from '@aws-sdk/client-eventbridge';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';

const REGION = process.env.AWS_REGION || 'us-west-2';
const ROLE_NAME = 'StepFunctionLambdaRoleLatest';
const BUCKET_NAME = 'stepfunction-poc-bucket-12345';
const STATE_MACHINE_NAME = 'ProviderDataProcessingLatest';
const EVENT_RULE_NAME = 'StepFunctionTriggerRuleLatest';

const sfnClient = new SFNClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const iamClient = new IAMClient({ region: REGION });
const s3Client = new S3Client({ 
  region: REGION,
  forcePathStyle: true,
  useAccelerateEndpoint: false,
  followRegionRedirects: true,
  maxAttempts: 3
});
// const eventBridgeClient = new EventBridgeClient({ region: REGION });

// Lambda function configurations
const lambdaFunctions = [
  {
    name: 'providerEndpoint',
    handler: 'providerEndpoint.handler',
    timeout: 30,
    memorySize: 128
  },
  {
    name: 'decryptionHandler',
    handler: 'decryptionHandler.handler',
    timeout: 30,
    memorySize: 128
  },
  {
    name: 'extractOrgs',
    handler: 'extractOrgs.handler',
    timeout: 30,
    memorySize: 128
  },
  {
    name: 'cloudflareFetchHandler',
    handler: 'cloudflareFetchHandler.handler',
    timeout: 30,
    memorySize: 128
  },
  {
    name: 'prepareDataToFiles',
    handler: 'prepareDataToFiles.handler',
    timeout: 60,
    memorySize: 256
  }
];

// Create Lambda function zip file
const createLambdaZip = async (functionName: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(path.join(__dirname, `${functionName}.zip`));
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const zipBuffer = fs.readFileSync(path.join(__dirname, `${functionName}.zip`));
      fs.unlinkSync(path.join(__dirname, `${functionName}.zip`));
      resolve(zipBuffer);
    });

    archive.on('error', reject);
    archive.pipe(output);

    // Add Lambda function code from dist/lambda directory
    const jsPath = path.join(__dirname, 'lambda', `${functionName}.js`);
    if (fs.existsSync(jsPath)) {
      archive.file(jsPath, { name: `${functionName}.js` });
    } else {
      console.error(`Compiled JavaScript file not found: ${jsPath}`);
      reject(new Error(`Compiled JavaScript file not found: ${jsPath}`));
      return;
    }

    // Add package.json with CommonJS configuration
    const packageJson = {
      name: functionName,
      version: '1.0.0',
      main: `${functionName}.js`,
      type: 'commonjs'
    };
    archive.append(JSON.stringify(packageJson, null, 2), { name: 'package.json' });

    archive.finalize();
  });
};

// Check if role exists
const getExistingRole = async () => {
  try {
    const role = await iamClient.send(new GetRoleCommand({
      RoleName: ROLE_NAME
    }));
    return role.Role?.Arn;
  } catch (error: any) {
    if (error.name === 'NoSuchEntity' || error.name === 'NoSuchEntityException') {
      console.log(`Role ${ROLE_NAME} does not exist, will create it`);
      return undefined;
    }
    console.error('Error checking for existing role:', error);
    return false;
    // throw error;
  }
};

// Create IAM role for Lambda functions
const createLambdaRole = async () => {
  try {
    // Check if role exists
    const existingRoleArn = await getExistingRole();
    if (existingRoleArn) {
      console.log(`Using existing role ${ROLE_NAME}:`, existingRoleArn);
      return existingRoleArn;
    }

    console.log(`Creating new role ${ROLE_NAME}...`);
    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: [
              'lambda.amazonaws.com',
              'states.amazonaws.com'
            ]
          },
          Action: ['sts:AssumeRole']
        }
      ]
    };

    try {
      const role = await iamClient.send(new CreateRoleCommand({
        RoleName: ROLE_NAME,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy)
      }));

      if (!role.Role?.Arn) {
        throw new Error('Failed to create role: No ARN returned');
      }

      console.log(`Created role ${ROLE_NAME}:`, role.Role.Arn);

      // Attach necessary policies
      const policies = [
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        'arn:aws:iam::aws:policy/AmazonS3FullAccess',
        'arn:aws:iam::aws:policy/CloudWatchLogsFullAccess',
        'arn:aws:iam::aws:policy/service-role/AWSLambdaRole'
      ];

      for (const policyArn of policies) {
        console.log(`Attaching policy ${policyArn} to role ${ROLE_NAME}...`);
        await iamClient.send(new AttachRolePolicyCommand({
          RoleName: ROLE_NAME,
          PolicyArn: policyArn
        }));
      }

      // Add inline policy for specific S3 permissions
      const s3InlinePolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              's3:CreateBucket',
              's3:DeleteBucket',
              's3:GetBucketLocation',
              's3:ListBucket',
              's3:PutBucketNotification',
              's3:GetBucketNotification',
              's3:PutObject',
              's3:GetObject',
              's3:DeleteObject'
            ],
            Resource: [
              `arn:aws:s3:::${BUCKET_NAME}`,
              `arn:aws:s3:::${BUCKET_NAME}/*`
            ]
          }
        ]
      };

      console.log(`Adding inline S3 policy to role ${ROLE_NAME}...`);
      await iamClient.send(new PutRolePolicyCommand({
        RoleName: ROLE_NAME,
        PolicyName: 'S3BucketAccess',
        PolicyDocument: JSON.stringify(s3InlinePolicy)
      }));

      // Wait for role propagation (IAM changes can take a few seconds to propagate)
      console.log('Waiting for IAM role to propagate...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      return role.Role.Arn;
    } catch (createError: any) {
      if (createError.name === 'EntityAlreadyExists') {
        console.log(`Role ${ROLE_NAME} already exists, getting ARN...`);
        const existingRole = await iamClient.send(new GetRoleCommand({
          RoleName: ROLE_NAME
        }));
        return existingRole.Role?.Arn;
      }
      throw createError;
    }
  } catch (error) {
    console.error('Error in createLambdaRole:', error);
    throw error;
  }
};

// Clean up existing role
const cleanupRole = async () => {
  try {
    const { AttachedPolicies } = await iamClient.send(new ListAttachedRolePoliciesCommand({
      RoleName: ROLE_NAME
    }));

    if (AttachedPolicies) {
      for (const policy of AttachedPolicies) {
        await iamClient.send(new DetachRolePolicyCommand({
          RoleName: ROLE_NAME,
          PolicyArn: policy.PolicyArn
        }));
      }
    }

    await iamClient.send(new DeleteRoleCommand({
      RoleName: ROLE_NAME
    }));
  } catch (error) {
    console.log('No existing role to clean up');
  }
};

// Helper function for retrying operations
const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  maxAttempts: number = 10,
  baseDelay: number = 2000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (error.name === 'ResourceConflictException') {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`[RETRY] Attempt ${attempt}/${maxAttempts} failed with ResourceConflictException. Waiting ${delay/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // For other errors, retry with shorter delay
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(1.5, attempt - 1);
        console.log(`[RETRY] Attempt ${attempt}/${maxAttempts} failed. Waiting ${delay/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// Helper function to wait for Lambda function to be ready
const waitForLambdaFunction = async (functionName: string, maxAttempts: number = 10): Promise<boolean> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await lambdaClient.send(new GetFunctionCommand({
        FunctionName: functionName
      }));
      
      if (response.Configuration?.State === 'Active') {
        return true;
      }
      
      console.log(`Function ${functionName} is not ready yet, waiting... (attempt ${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return false;
      }
      console.error(`Error checking function state:`, error);
      return false;
    }
  }
  return false;
};

// Create Lambda functions
const createLambdaFunctions = async (roleArn: string) => {
  const functionArns: { [key: string]: string } = {};

  for (const func of lambdaFunctions) {
    const zipBuffer = await createLambdaZip(func.name);
    
    try {
      // Check if function exists
      let functionExists = false;
      try {
        await lambdaClient.send(new GetFunctionCommand({
          FunctionName: func.name
        }));
        functionExists = true;
        console.log(`Function ${func.name} exists, updating code...`);
      } catch (error: any) {
        if (error.name !== 'ResourceNotFoundException') {
          throw error;
        }
      }

      if (functionExists) {
        // Just update the function code
        await lambdaClient.send(new UpdateFunctionCodeCommand({
          FunctionName: func.name,
          ZipFile: zipBuffer
        }));
        console.log(`Updated function ${func.name} code`);

        // Get the function ARN
        const response = await lambdaClient.send(new GetFunctionCommand({
          FunctionName: func.name
        }));
        if (response.Configuration?.FunctionArn) {
          functionArns[func.name] = response.Configuration.FunctionArn;
          console.log(`Function ${func.name} ARN:`, response.Configuration.FunctionArn);
        }
      } else {
        // Create new function
        console.log(`Creating new function ${func.name}...`);
        const response = await lambdaClient.send(new CreateFunctionCommand({
          FunctionName: func.name,
          Runtime: 'nodejs18.x',
          Handler: func.handler,
          Role: roleArn,
          Code: { ZipFile: zipBuffer },
          Timeout: func.timeout,
          MemorySize: func.memorySize,
          Environment: {
            Variables: {
              BUCKET_NAME,
              CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || ''
            }
          }
        }));

        if (response.FunctionArn) {
          functionArns[func.name] = response.FunctionArn;
          console.log(`Created function ${func.name}:`, response.FunctionArn);
        }
      }
    } catch (error) {
      console.error(`Error managing function ${func.name}:`, error);
      throw error;
    }
  }

  return functionArns;
};

// Check if bucket exists
const checkBucketExists = async (bucketName: string) => {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`Bucket ${bucketName} exists`);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
      console.log(`Bucket ${bucketName} does not exist`);
      return false;
    }
    console.error('Error checking bucket:', error);
    return false;
  }
};

// Create S3 bucket
const createS3Bucket = async (functionArns: { [key: string]: string }) => {
  try {
    // Check if bucket exists
    const bucketExists = await checkBucketExists(BUCKET_NAME);
    if (bucketExists) {
      console.log(`Using existing bucket ${BUCKET_NAME}`);
    } else {
      try {
        // Create the bucket with region
        await s3Client.send(new CreateBucketCommand({
          Bucket: BUCKET_NAME,
          CreateBucketConfiguration: {
            LocationConstraint: REGION === 'us-east-1' ? undefined : REGION as BucketLocationConstraint
          }
        }));
        console.log(`Created new bucket ${BUCKET_NAME} in region ${REGION}`);
      } catch (error: any) {
        console.error('Error creating bucket:', error);
        // If bucket creation fails, try to use existing bucket
        console.log('Attempting to use existing bucket...');
      }
    }

    // Add permission for S3 to invoke Lambda
    try {
      await lambdaClient.send(new AddPermissionCommand({
        Action: 'lambda:InvokeFunction',
        FunctionName: functionArns.prepareDataToFiles,
        Principal: 's3.amazonaws.com',
        SourceArn: `arn:aws:s3:::${BUCKET_NAME}`,
        StatementId: 'S3InvokeLambda'
      }));

      // Wait for permissions to propagate
      console.log('Waiting for Lambda permissions to propagate...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Configure bucket notification
      await s3Client.send(new PutBucketNotificationConfigurationCommand({
        Bucket: BUCKET_NAME,
        NotificationConfiguration: {
          LambdaFunctionConfigurations: [
            {
              LambdaFunctionArn: functionArns.prepareDataToFiles,
              Events: ['s3:ObjectCreated:*']
            }
          ]
        }
      }));

      return BUCKET_NAME;
    } catch (error: any) {
      console.error('Error configuring bucket:', error);
      // Continue even if configuration fails
      return BUCKET_NAME;
    }
  } catch (error) {
    console.error('Error with S3 bucket:', error);
    // Return bucket name even if there are errors
    return BUCKET_NAME;
  }
};

// Comment out EventBridge rule creation
// const createEventBridgeRule = async (stateMachineArn: string, roleArn: string) => {
//   try {
//     console.log('Creating EventBridge rule...');
//     const rule = await eventBridgeClient.send(new PutRuleCommand({
//       Name: EVENT_RULE_NAME,
//       ScheduleExpression: 'rate(1 day)',
//       State: 'ENABLED',
//       Description: 'Trigger for Step Functions state machine'
//     }));

//     console.log('Adding target to EventBridge rule...');
//     await eventBridgeClient.send(new PutTargetsCommand({
//       Rule: EVENT_RULE_NAME,
//       Targets: [{
//         Id: 'StepFunctionTarget',
//         Arn: stateMachineArn,
//         RoleArn: roleArn,
//         Input: JSON.stringify({})
//       }]
//     }));

//     console.log('EventBridge rule created successfully');
//   } catch (error) {
//     console.error('Error creating EventBridge rule:', error);
//     throw error;
//   }
// };

// Create Step Functions state machine
const createStateMachine = async (functionArns: { [key: string]: string }, roleArn: string) => {
  const stateMachineDefinition = {
    Comment: "State machine for processing provider data",
    StartAt: "ProviderEndpoint",
    States: {
      ProviderEndpoint: {
        Type: "Task",
        Resource: functionArns.providerEndpoint,
        Next: "DecryptionHandler",
        Retry: [
          {
            ErrorEquals: ["States.ALL"],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2
          }
        ]
      },
      DecryptionHandler: {
        Type: "Task",
        Resource: functionArns.decryptionHandler,
        Next: "ExtractOrgs",
        Retry: [
          {
            ErrorEquals: ["States.ALL"],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2
          }
        ]
      },
      ExtractOrgs: {
        Type: "Task",
        Resource: functionArns.extractOrgs,
        Next: "ProcessOrgs",
        Retry: [
          {
            ErrorEquals: ["States.ALL"],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2
          }
        ]
      },
      ProcessOrgs: {
        Type: "Map",
        ItemsPath: "$.body.orgIds",
        MaxConcurrency: 10,
        Next: "PrepareDataToFiles",
        Retry: [
          {
            ErrorEquals: ["States.ALL"],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2
          }
        ],
        Iterator: {
          StartAt: "CloudflareFetchHandler",
          States: {
            CloudflareFetchHandler: {
              Type: "Task",
              Resource: functionArns.cloudflareFetchHandler,
              End: true,
              Retry: [
                {
                  ErrorEquals: ["States.ALL"],
                  IntervalSeconds: 2,
                  MaxAttempts: 3,
                  BackoffRate: 2
                }
              ]
            }
          }
        }
      },
      PrepareDataToFiles: {
        Type: "Task",
        Resource: functionArns.prepareDataToFiles,
        Parameters: {
          "batchResults.$": "$"
        },
        End: true,
        Retry: [
          {
            ErrorEquals: ["States.ALL"],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2
          }
        ]
      }
    }
  };

  try {
    // Add delay to handle resource conflict
    console.log('Waiting for any ongoing updates to complete...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay

    // Check if state machine exists
    const existingMachine = await getExistingStateMachine();
    
    if (existingMachine?.stateMachineArn) {
      console.log(`Updating existing state machine ${STATE_MACHINE_NAME}...`);
      await sfnClient.send(new UpdateStateMachineCommand({
        stateMachineArn: existingMachine.stateMachineArn,
        definition: JSON.stringify(stateMachineDefinition),
        roleArn
      }));
      console.log(`Updated state machine:`, existingMachine.stateMachineArn);
      return existingMachine.stateMachineArn;
    } else {
      console.log(`Creating new state machine ${STATE_MACHINE_NAME}...`);
      const response = await sfnClient.send(new CreateStateMachineCommand({
        name: STATE_MACHINE_NAME,
        definition: JSON.stringify(stateMachineDefinition),
        roleArn
      }));
      console.log(`Created state machine:`, response.stateMachineArn);
      return response.stateMachineArn;
    }
  } catch (error) {
    console.error('Error managing state machine:', error);
    throw error;
  }
};

// Check if state machine exists
const getExistingStateMachine = async () => {
  try {
    const { stateMachines } = await sfnClient.send(new ListStateMachinesCommand({}));
    return stateMachines?.find(machine => machine.name === STATE_MACHINE_NAME);
  } catch (error) {
    console.error('Error checking existing state machine:', error);
    return undefined;
  }
};

// Main function
const main = async () => {
  try {
    // Create or get IAM role
    console.log('Creating/Getting IAM role...');
    const roleArn = await createLambdaRole();
    if (!roleArn) throw new Error('Failed to create/get IAM role');
    console.log('IAM role ready:', roleArn);

    // Create Lambda functions
    console.log('Creating/Updating Lambda functions...');
    const functionArns = await createLambdaFunctions(roleArn);
    console.log('Lambda functions ready');

    // Create S3 bucket with Lambda permissions
    console.log('Creating/Configuring S3 bucket...');
    await createS3Bucket(functionArns);
    console.log('S3 bucket ready');

    // Create state machine
    const stateMachineArn = await createStateMachine(functionArns, roleArn);
    console.log('State machine created successfully:', stateMachineArn);

    // Comment out EventBridge rule creation
    // await createEventBridgeRule(stateMachineArn, roleArn);

    console.log('Setup completed successfully!');
    console.log('To trigger the state machine, run:');
    console.log(`npm run trigger ${stateMachineArn}`);
  } catch (error) {
    console.error('Error in setup:', error);
    process.exit(1);
  }
};

main().catch(console.error); 