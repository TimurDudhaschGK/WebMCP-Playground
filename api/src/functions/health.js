const { app } = require('@azure/functions');

const PROBE_TIMEOUT_MS = 2000;

/** Blob service endpoint for the host storage account, from identity-based or connection-string settings. */
function blobServiceUri() {
  const direct = process.env.AzureWebJobsStorage__blobServiceUri || process.env.AzureWebJobsStorage__serviceUri;
  if (direct) return direct;

  const account = process.env.AzureWebJobsStorage__accountName;
  if (account) return `https://${account}.blob.core.windows.net/`;

  const connection = process.env.AzureWebJobsStorage;
  if (!connection) return undefined;

  const parts = new Map(
    connection
      .split(';')
      .filter(Boolean)
      .map((pair) => {
        const split = pair.indexOf('=');
        return split < 0 ? ['', ''] : [pair.slice(0, split).trim().toLowerCase(), pair.slice(split + 1)];
      })
  );
  const endpoint = parts.get('blobendpoint');
  if (endpoint) return endpoint;
  const name = parts.get('accountname');
  const suffix = parts.get('endpointsuffix') || 'core.windows.net';
  return name ? `https://${name}.blob.${suffix}/` : undefined;
}

/** Any HTTP response proves DNS, TLS and the service are up; an anonymous probe never needs credentials. */
async function storageReachable() {
  const uri = blobServiceUri();
  if (!uri) return false;
  try {
    await fetch(uri, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => {
    const storageOk = await storageReachable();

    return {
      status: storageOk ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
      // Verdicts only: never echo endpoints, setting values or exception detail to the caller.
      jsonBody: {
        status: storageOk ? 'healthy' : 'degraded',
        storage: storageOk ? 'ok' : 'unavailable'
      }
    };
  }
});
