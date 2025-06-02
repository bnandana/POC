export interface ProviderResponse {
  providerId: string;
  resourceType: string;
  providerName: string;
  externalId: string;
  secrets: string;
  connectorParams: any;
  orgs: Array<{
    orgId: string;
    connectorParams: {
      exchange_id: string;
      ticker_symbol: string;
      ticker_symbols: string;
      key_development_list: string;
    };
  }>;
}

export interface LambdaResponse {
  statusCode: number;
  body: any;
}

export interface CloudflareData {
  orgId: string;
  connectorParams: any;
  radarData: any;
  timestamp: string;
}

export interface ExtractedOrg {
  id: string;
  connectorParams: any;
}

export interface ExtractedOrgsResponse {
  orgIds: ExtractedOrg[];
} 