import https from 'https';

interface ConnectorParams {
    exchange_id: string;
    ticker_symbol: string;
}

interface CloudflareResponse {
    status: number;
    data: any;
}

interface CloudflareData {
    orgId: string;
    connectorParams: ConnectorParams;
    radarData: any;
    timestamp: string;
}

interface LambdaResponse {
    statusCode: number;
    body: CloudflareData | { error: string; message: string };
}

/**
 * Makes API calls to Cloudflare to fetch radar data using native https module
 * Uses the organization's connector parameters to make the appropriate API calls
 * 
 * @param event - The event object containing organization data
 * @returns Promise<LambdaResponse> - The response containing Cloudflare data
 */
export const handler = async (event: any): Promise<LambdaResponse> => {
    console.log('='.repeat(80));
    console.log('[CLOUDFLARE FETCH] Starting Cloudflare data fetch');
    console.log('='.repeat(80));

    try {
        const { id, connectorParams } = event;
        const bearerToken = 'your-token'; // hardcoded token replace with actaul token when deploying to AWS

        console.log('[CLOUDFLARE FETCH] Processing organization:', {
            orgId: id,
            exchangeId: connectorParams.exchange_id,
            tickerSymbol: connectorParams.ticker_symbol
        });

        // Function to make Cloudflare API request
        const makeCloudflareRequest = (path: string): Promise<CloudflareResponse> => {
            return new Promise((resolve, reject) => {
                const options = {
                    hostname: 'api.cloudflare.com',
                    path: path,
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${bearerToken}`,
                        'Content-Type': 'application/json'
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        try {
                            const parsedData = JSON.parse(data);
                            resolve({
                                status: res.statusCode || 500,
                                data: parsedData
                            });
                        } catch (parseError) {
                            reject(new Error(`Failed to parse response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(new Error(`Request failed: ${error.message}`));
                });

                req.end();
            });
        };

        // Fetch attack data from Cloudflare Radar
        console.log('[CLOUDFLARE FETCH] Making API call to Cloudflare');
        const radarResponse = await makeCloudflareRequest('/client/v4/radar/attacks/layer3/top/locations/target?dateRange=30d&format=json');
        
        console.log('[CLOUDFLARE FETCH] API response received:', {
            status: radarResponse.status,
            dataSize: JSON.stringify(radarResponse.data).length
        });

        const cloudflareData: CloudflareData = {
            orgId: id,
            connectorParams: connectorParams,
            radarData: radarResponse.data,
            timestamp: new Date().toISOString()
        };

        console.log('[CLOUDFLARE FETCH] Processed data:', {
            orgId: cloudflareData.orgId,
            dataSize: JSON.stringify(cloudflareData.radarData).length,
            timestamp: cloudflareData.timestamp
        });
        
        console.log('='.repeat(80));
        console.log('[CLOUDFLARE FETCH] Successfully completed data fetch');
        console.log('='.repeat(80));
        
        return {
            statusCode: 200,
            body: cloudflareData
        };
    } catch (error) {
        console.error('='.repeat(80));
        console.error('[CLOUDFLARE FETCH ERROR]', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        console.error('='.repeat(80));

        return {
            statusCode: 500,
            body: {
                error: 'Failed to fetch Cloudflare data',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            }
        };
    }
}; 
