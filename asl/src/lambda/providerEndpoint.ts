import { ProviderResponse, LambdaResponse } from './types';

/**
 * Simulates fetching data from a provider
 * In a real implementation, this would make an API call to the provider
 * 
 * @param event - The event object from AWS Lambda
 * @returns Promise<LambdaResponse> - The response containing provider data
 */
export const handler = async (event: any): Promise<LambdaResponse> => {
    console.log('='.repeat(80));
    console.log('[PROVIDER ENDPOINT] Starting provider data fetch');
    console.log('='.repeat(80));

    try {
        // Simulate fetching data from a provider
        console.log('[PROVIDER DATA] Generating simulated provider response');
        const response: ProviderResponse = {
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
        };

        console.log('[PROVIDER DATA] Generated response with details:', {
            providerId: response.providerId,
            providerName: response.providerName,
            orgCount: response.orgs.length,
            orgIds: response.orgs.map(org => org.orgId)
        });

        console.log('='.repeat(80));
        console.log('[PROVIDER ENDPOINT] Successfully completed provider data fetch');
        console.log('='.repeat(80));
        
        return {
            statusCode: 200,
            body: response
        };
    } catch (error) {
        console.error('='.repeat(80));
        console.error('[PROVIDER ENDPOINT ERROR]', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        console.error('='.repeat(80));

        return {
            statusCode: 500,
            body: {
                error: 'Failed to fetch provider data',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            }
        };
    }
}; 