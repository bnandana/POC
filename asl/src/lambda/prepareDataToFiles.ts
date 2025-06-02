import { CloudflareData, LambdaResponse } from './types';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * S3 client configuration
 * Uses environment variables for region and bucket name with fallback values
 */
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });
const BUCKET_NAME = process.env.BUCKET_NAME || 'stepfunction-poc-bucket-12345';

/**
 * Interface for the batch results from the Map state
 * Contains an array of processed Cloudflare data with status codes
 */
interface BatchResults {
    batchResults: Array<{
        statusCode: number;
        body: CloudflareData;
    }>;
}

/**
 * Converts Cloudflare data to CSV format without manipulation
 * @param data - The Cloudflare data to convert
 * @returns CSV string with headers and data row
 */
function convertToCSV(data: CloudflareData): string {
    console.log(`[CSV Conversion] Starting conversion for org ${data.orgId}`);
    console.log(`[CSV Conversion] Raw data:`, JSON.stringify(data.radarData, null, 2));

    // Get all keys from the radar data
    const allKeys = new Set<string>();
    const flattenObject = (obj: any, prefix = '') => {
        for (const key in obj) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                flattenObject(obj[key], prefix ? `${prefix}.${key}` : key);
            } else {
                allKeys.add(prefix ? `${prefix}.${key}` : key);
            }
        }
    };
    flattenObject(data.radarData);

    // Create header row
    const headers = Array.from(allKeys);
    
    // Create data row
    const getValue = (obj: any, path: string) => {
        return path.split('.').reduce((acc, part) => acc?.[part], obj) ?? '';
    };
    
    const row = headers.map(header => getValue(data.radarData, header));
    
    // Combine headers and row
    const csvContent = [
        headers.join(','),
        row.join(',')
    ].join('\n');
    
    console.log(`[CSV Conversion] Generated CSV with headers:`, headers);
    console.log(`[CSV Conversion] Sample CSV content:`, csvContent.substring(0, 200) + '...');
    
    return csvContent;
}

/**
 * Lambda handler function that processes batch results and saves them to S3
 * Creates both JSON and CSV files in the format: {orgId}/{timestamp}/data.{json|csv}
 * 
 * @param event - Batch results from the Map state
 * @returns Response with status and processing summary
 */
export const handler = async (event: BatchResults): Promise<LambdaResponse> => {
    const startTime = new Date();
    console.log('='.repeat(80));
    console.log('[PROCESSING START]', {
        timestamp: startTime.toISOString(),
        totalRecords: event.batchResults.length,
        bucketName: BUCKET_NAME
    });
    console.log('='.repeat(80));
    
    try {
        const timestamp = startTime.toISOString();
        const results = event.batchResults;
        let processedCount = 0;
        
        // Process each result and save to S3
        for (const [index, result] of results.entries()) {
            console.log('-'.repeat(40));
            console.log(`[Processing Record ${index + 1}/${results.length}]`);
            
            if (result.statusCode !== 200) {
                throw new Error(`Invalid status code ${result.statusCode} for record ${index + 1}`);
            }

            const data = result.body;
            console.log(`[Record Details]`, {
                orgId: data.orgId,
                timestamp: data.timestamp,
                exchangeId: data.connectorParams.exchange_id,
                tickerSymbol: data.connectorParams.ticker_symbol
            });
            
            // Save JSON file
            const jsonKey = `${data.orgId}/${timestamp}/data.json`;
            console.log(`[S3 Upload] Starting JSON upload to: ${jsonKey}`);
            await s3Client.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: jsonKey,
                Body: JSON.stringify(data),
                ContentType: 'application/json'
            }));
            console.log(`[S3 Upload] JSON upload completed for: ${jsonKey}`);
            
            // Save CSV file
            const csvKey = `${data.orgId}/${timestamp}/data.csv`;
            console.log(`[S3 Upload] Starting CSV upload to: ${csvKey}`);
            const csvData = convertToCSV(data);
            console.log(`[S3 Upload] CSV data generated, size: ${csvData.length} bytes`);
            
            await s3Client.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: csvKey,
                Body: csvData,
                ContentType: 'text/csv'
            }));
            console.log(`[S3 Upload] CSV upload completed for: ${csvKey}`);
            
            console.log(`[Success] Processed org ${data.orgId}`);
            processedCount++;
        }
        
        const endTime = new Date();
        const processingTime = endTime.getTime() - startTime.getTime();
        
        console.log('='.repeat(80));
        console.log('[PROCESSING COMPLETE]', {
            timestamp: endTime.toISOString(),
            processingTimeMs: processingTime,
            processedCount,
            successRate: '100%'
        });
        console.log('='.repeat(80));
        
        return {
            statusCode: 200,
            body: {
                message: 'Data processing completed',
                bucketName: BUCKET_NAME,
                processedCount,
                processingTimeMs: processingTime,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString()
            }
        };
    } catch (error) {
        const errorTime = new Date();
        console.error('='.repeat(80));
        console.error('[FATAL ERROR]', {
            timestamp: errorTime.toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        console.error('='.repeat(80));
        
        return {
            statusCode: 500,
            body: {
                error: 'Failed to process data',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: errorTime.toISOString()
            }
        };
    }
}; 