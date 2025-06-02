import {
  SFNClient,
  StartExecutionCommand,
  ListExecutionsCommand,
  GetExecutionHistoryCommand
} from '@aws-sdk/client-sfn';

const REGION = process.env.AWS_REGION || 'us-east-1';
const sfnClient = new SFNClient({ region: REGION });

// List state machine executions
const listExecutions = async (stateMachineArn: string) => {
  const response = await sfnClient.send(new ListExecutionsCommand({
    stateMachineArn
  }));

  console.log('Recent executions:', response.executions);
  return response.executions;
};

// Get execution history
const getExecutionHistory = async (executionArn: string) => {
  const response = await sfnClient.send(new GetExecutionHistoryCommand({
    executionArn
  }));

  console.log('Execution history:', response.events);
  return response.events;
};

// Trigger state machine execution
const triggerStateMachine = async (stateMachineArn: string) => {
  const response = await sfnClient.send(new StartExecutionCommand({
    stateMachineArn,
    input: JSON.stringify({
      providerId: "provider-1",
      resourceType: "activity-center",
      providerName: "Provider 1",
      externalId: "schedule-activity-center-import-test",
      secrets: "****************************",
      connectorParams: {
        snowflake_schema: "XPRESSFEED",
        snowflake_warehouse: "XF_READER_DILIGENTCORP_WH",
        snowflake_account: "idb71831.us-east-1",
        snowflake_database: "MI_XPRESSCLOUD",
        key_development_list: "28,74,75,101,52,80,81,82,94,26,27"
      },
      orgs: [
        {
          orgId: "155",
          connectorParams: {
            exchange_id: "3",
            ticker_symbol: "AMZN",
            ticker_symbols: "MSFT-458, NFLX-458, GOOGL-458",
            key_development_list: "28,74,75,101,52,80,81,82,94,26,27"
          }
        },
        {
          orgId: "148",
          connectorParams: {
            exchange_id: "3",
            ticker_symbol: "MSFT",
            ticker_symbols: "AMZN-458, NFLX-458, GOOGL-458",
            key_development_list: "28,74,75,101,52,80,81,82,94,26,27"
          }
        }
      ]
    })
  }));

  console.log('Started execution:', response.executionArn);

  // Wait for 5 seconds to allow execution to progress
  await new Promise(resolve => setTimeout(resolve, 5000));

  // List executions and get history
  await listExecutions(stateMachineArn);
  if (response.executionArn) {
    await getExecutionHistory(response.executionArn);
  }

  return response.executionArn;
};

// Main function
const main = async () => {
  try {
    // Get state machine ARN from command line argument
    const stateMachineArn = process.argv[2];
    if (!stateMachineArn) {
      throw new Error('Please provide the state machine ARN as a command line argument');
    }

    console.log('Triggering state machine...');
    await triggerStateMachine(stateMachineArn);
    console.log('State machine triggered successfully');
  } catch (error) {
    console.error('Error triggering state machine:', error);
    throw error;
  }
};

main().catch(console.error); 