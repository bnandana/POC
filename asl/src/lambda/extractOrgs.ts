import { ProviderResponse, LambdaResponse, ExtractedOrgsResponse, ExtractedOrg } from './types';

/**
 * Extracts organization data from the decrypted provider payload
 * Processes the orgs array to create a simplified structure with essential data
 * 
 * @param event - The event object containing decrypted provider data
 * @returns Promise<LambdaResponse> - The response containing extracted organization data
 */
export const handler = async (event: any): Promise<LambdaResponse> => {
    console.log('='.repeat(80));
    console.log('[EXTRACT ORGS] Starting organization data extraction');
    console.log('='.repeat(80));

    try {
        const providerData: ProviderResponse = event.body;
        console.log('[EXTRACT ORGS] Processing provider data:', {
            providerId: providerData.providerId,
            providerName: providerData.providerName,
            totalOrgs: providerData.orgs.length
        });
        
        // Extract organization data
        console.log('[EXTRACT ORGS] Extracting organization details');
        const orgIds: ExtractedOrg[] = providerData.orgs.map(org => {
            console.log(`[EXTRACT ORGS] Processing org ${org.orgId}`);
            return {
                id: org.orgId,
                connectorParams: org.connectorParams
            };
        });
        
        const response: ExtractedOrgsResponse = {
            orgIds
        };

        console.log('[EXTRACT ORGS] Extraction completed:', {
            processedOrgs: orgIds.length,
            orgIds: orgIds.map(org => org.id)
        });
        
        console.log('='.repeat(80));
        console.log('[EXTRACT ORGS] Process completed successfully');
        console.log('='.repeat(80));
        
        return {
            statusCode: 200,
            body: response
        };
    } catch (error) {
        console.error('='.repeat(80));
        console.error('[EXTRACT ORGS ERROR]', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        console.error('='.repeat(80));

        return {
            statusCode: 500,
            body: {
                error: 'Failed to extract organization data',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            }
        };
    }
}; 