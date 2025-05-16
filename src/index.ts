// === Configuration ===
/** Configuration constants */
const CONFIG = {
    ETH_RPC: 'https://eth-mainnet.g.alchemy.com/v2/9MBCtERqR47MU430jVMJIGtK_mfVBxwf',
    ETH_RPC_FALLBACK: 'https://eth.llamarpc.com',
    SOL_RPC: 'https://api.mainnet-beta.solana.com',
    BTC_API: 'https://api.blockchair.com/bitcoin/stats',
    CACHE_TTL: 3600, // seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // ms
};

// === Types ===
/** Ethereum token configuration */
interface EthToken {
    symbol: string;
    address: string;
}

/** Solana token configuration */
interface SolToken {
    symbol: string;
    mint: string;
}

/** Supply data for a token */
interface TokenSupply {
    symbol: string;
    supply: string;
    address?: string; // Added for Ethereum tokens
    mint?: string; // Added for Solana tokens
}

/** API response payload */
interface ApiPayload {
    ethereum: TokenSupply[];
    solana: TokenSupply[];
    ethereumTotal: string;
    solanaTotal: string;
    grandTotal: string;
    currentlyMintedBTC: string;
    lastUpdated: string; // Added for data freshness
}

// === Tokens ===
/** Ethereum wrapped-BTC tokens */
const ethTokens: EthToken[] = [
    { symbol: 'wBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    { symbol: 'renBTC', address: '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d' },
    { symbol: 'tBTCv1', address: '0x8daebade922df735c38c80c7ebd708af50815faa' },
    { symbol: 'tBTCv2', address: '0x18084fba666a33d37592fa2633fd49a74dd93a88' },
    { symbol: 'cbBTC', address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf' },
];

/** Solana wrapped-BTC mints */
const solTokens: SolToken[] = [
    { symbol: 'wBTC', mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh' },
    { symbol: 'renBTC', mint: 'CDJWUqTcYTVAKXAVXoQZFes5JUFc7owSeq7eMQcDSbo5' },
    { symbol: 'pBTC', mint: 'DYDWu4hE4MN3aH897xQ3sRTs5EAjJDmQsKLNhbpUiKun' },
    { symbol: 'cbBTC', mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij' },
    { symbol: 'zBTC', mint: 'zBTCug3er3tLyffELcvDNrKkCymbPWysGcWihESYfLg' },
    { symbol: 'tBTC', mint: '6DNSN2BJsaPFdFFc1zP37kkeNe4Usc1Sqkzr9C9vPWcU' },
];

// === Utilities ===
// (Unchanged from previous version)
function formatUnits(value: bigint, decimals: number): string {
    const str = value.toString().padStart(decimals + 1, '0');
    const i = str.length - decimals;
    const intPart = str.slice(0, i) || '0';
    const fracPart = str.slice(i).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function formatNumber(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function calculateTotal(tokens: TokenSupply[]): string {
    return tokens
        .reduce((sum, token) => sum + (parseFloat(token.supply) || 0), 0)
        .toFixed(8);
}

async function withRetry<T>(
    fn: () => Promise<T>,
    attempts: number = CONFIG.RETRY_ATTEMPTS,
    delay: number = CONFIG.RETRY_DELAY
): Promise<T> {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === attempts - 1) throw err;
            await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
        }
    }
    throw new Error('Retry attempts exhausted');
}

// === Ethereum Fetch ===
// (Unchanged except for adding address to TokenSupply)
const TOTAL_SUPPLY_SIG = '0x18160ddd';
const DECIMALS_SIG = '0x313ce567';

async function fetchSingleSupply(token: EthToken, rpcUrl: string): Promise<TokenSupply> {
    const supplyReq = {
        jsonrpc: '2.0',
        id: 'supply',
        method: 'eth_call',
        params: [{ to: token.address, data: TOTAL_SUPPLY_SIG }, 'latest'],
    };
    const decimalsReq = {
        jsonrpc: '2.0',
        id: 'decimals',
        method: 'eth_call',
        params: [{ to: token.address, data: DECIMALS_SIG }, 'latest'],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const [supplyRes, decimalsRes] = await Promise.all([
            fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(supplyReq),
                signal: controller.signal,
            }).then((r) => r.json()),
            fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(decimalsReq),
                signal: controller.signal,
            }).then((r) => r.json()),
        ]);

        if (supplyRes.error || decimalsRes.error) {
            console.warn(`Single call failed for ${token.symbol}:`, {
                address: token.address,
                supplyError: supplyRes.error,
                decimalsError: decimalsRes.error,
            });
            return { symbol: token.symbol, supply: '0', address: token.address };
        }

        const supplyRaw = supplyRes.result ? BigInt(supplyRes.result) : 0n;
        const decimals = decimalsRes.result ? Number(BigInt(decimalsRes.result)) : 8;
        return { symbol: token.symbol, supply: formatUnits(supplyRaw, decimals), address: token.address };
    } catch (err) {
        console.error(`Failed to fetch single supply for ${token.symbol} at ${rpcUrl}:`, err);
        return { symbol: token.symbol, supply: '0', address: token.address };
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchEthereumSupplies(): Promise<TokenSupply[]> {
    const start = performance.now();
    const calls = ethTokens.flatMap((token: EthToken) => [
        { target: token.address, callData: TOTAL_SUPPLY_SIG },
        { target: token.address, callData: DECIMALS_SIG },
    ]);

    const supplies = await Promise.all(
        ethTokens.map((token) =>
            withRetry(() => fetchSingleSupply(token, CONFIG.ETH_RPC)).catch((err) => {
                console.warn(`Primary RPC failed for ${token.symbol}:`, err);
                return fetchSingleSupply(token, CONFIG.ETH_RPC_FALLBACK);
            })
        )
    );
    console.log(`Ethereum fetch (fallback) took ${performance.now() - start}ms`);
    return supplies;
}

// === Solana Fetch ===
async function fetchSolanaSupplies(): Promise<TokenSupply[]> {
    const start = performance.now();
    const mints = solTokens.map((t: SolToken) => t.mint);
    const req = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getMultipleAccounts',
        params: [mints, { encoding: 'base64' }],
    };

    const res = await withRetry(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const resp = await fetch(CONFIG.SOL_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req),
                signal: controller.signal,
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        } finally {
            clearTimeout(timeout);
        }
    });

    if (!res.result?.value) {
        console.error('Solana RPC failed:', res.error || 'No result');
        return solTokens.map((token) => ({ symbol: token.symbol, supply: '0', mint: token.mint }));
    }

    const accounts = res.result.value;
    const supplies: TokenSupply[] = solTokens.map((token: SolToken, idx: number) => {
        const acc = accounts[idx];
        if (!acc?.data) return { symbol: token.symbol, supply: '0', mint: token.mint };
        try {
            const data = Uint8Array.from(atob(acc.data[0]), (c) => c.charCodeAt(0));
            let raw = 0n;
            for (let i = 0; i < 8; i++) raw |= BigInt(data[36 + i]) << (8n * BigInt(i));
            const decimals = data[44] || 8;
            return { symbol: token.symbol, supply: formatUnits(raw, decimals), mint: token.mint };
        } catch (err) {
            console.error(`Failed to process ${token.symbol}:`, err);
            return { symbol: token.symbol, supply: '0', mint: token.mint };
        }
    });

    console.log(`Solana fetch took ${performance.now() - start}ms`);
    return supplies;
}

// === Bitcoin Fetch ===
async function fetchBitcoinSupply(): Promise<string> {
    try {
        const res = await withRetry(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const resp = await fetch(CONFIG.BTC_API, {
                    signal: controller.signal,
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return resp.json();
            } finally {
                clearTimeout(timeout);
            }
        });

        const supplySatoshis = res.data?.circulation;
        if (typeof supplySatoshis !== 'number' || supplySatoshis < 0 || supplySatoshis > 21_000_000 * 10 ** 8) {
            throw new Error('Invalid Bitcoin supply');
        }

        const supplyBTC = supplySatoshis / 10 ** 8;
        return formatNumber(supplyBTC);
    } catch (error) {
        console.error('Failed to fetch Bitcoin supply:', error);
        return '0';
    }
}

// === Price Fetch ===
async function fetchSolBtcPrice(): Promise<number> {
    try {
        const res = await withRetry(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=btc', {
                    signal: controller.signal,
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return resp.json();
            } finally {
                clearTimeout(timeout);
            }
        });

        const price = res.solana?.btc;
        if (typeof price !== 'number' || price <= 0) {
            throw new Error('Invalid SOL/BTC price');
        }
        return price;
    } catch (error) {
        console.error('Failed to fetch SOL/BTC price:', error);
        return 0.002; // Fallback price (~$100/SOL ÷ $50,000/BTC, rough estimate for April 2025)
    }
}

/** Sanitize HTML (simplified for Cloudflare Worker) */
function sanitizeHtml(html: string, options: { allowedTags: string[]; allowedAttributes: Record<string, string[]> }): string {
    return html; // Replace with sanitize-html in production
  }
  
  /** API response payload */
  interface ApiPayload {
    ethereum: Array<{ symbol: string; supply: string; address?: string }>;
    solana: Array<{ symbol: string; supply: string; mint?: string }>;
    ethereumTotal: string;
    solanaTotal: string;
    grandTotal: string;
    currentlyMintedBTC: string;
    lastUpdated: string;
    solBtcPrice: number; // Added for SOL/BTC price
  }
  
  /** Generate HTML UI */
  export function renderHtml(data: ApiPayload): string {
    const ethTotal = parseFloat(data.ethereumTotal) || 0;
    const solTotal = parseFloat(data.solanaTotal) || 0;
    const total = ethTotal + solTotal;
    const ethPercent = total > 0 ? ((ethTotal / total) * 100).toFixed(1) : 50;
    const solPercent = total > 0 ? ((solTotal / total) * 100).toFixed(1) : 50;
    const solBtcPrice = data.solBtcPrice || 0.002; // Fallback price
  
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Wrapped BTC Race: Ethereum vs Solana</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        .progress-bar {
          height: 1.5rem;
          border-radius: 0.25rem;
          overflow: hidden;
          display: flex;
        }
        .progress-eth {
          background-color: #60a5fa;
        }
        .progress-sol {
          background-color: #34d399;
        }
      </style>
    </head>
    <body class="bg-gray-100 text-gray-900 flex items-center justify-center min-h-screen">
      <main class="bg-white rounded-lg shadow-md p-6 w-full max-w-md">
        <!-- Header -->
        <header class="flex justify-between items-center mb-4">
          <h1 class="text-xl font-bold text-gray-800" role="heading" aria-level="1">Wrapped BTC Race</h1>
          <button id="refresh-btn" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-1 px-3 rounded" aria-label="Refresh data">
            Refresh
          </button>
        </header>
  
        <!-- Progress Bars -->
        <section class="mb-6" aria-labelledby="race-heading">
          <h2 id="race-heading" class="text-lg font-semibold text-gray-700 mb-2">Ethereum vs Solana</h2>
          <div class="progress-bar" role="progressbar" aria-label="Wrapped BTC distribution">
            <div class="progress-eth" style="width: ${ethPercent}%;" aria-valuenow="${ethPercent}" aria-valuemin="0" aria-valuemax="100"></div>
            <div class="progress-sol" style="width: ${solPercent}%;" aria-valuenow="${solPercent}" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
          <div class="flex justify-between text-sm text-gray-600 mt-2">
            <span>Ethereum: ${ethTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC (${ethPercent}%)</span>
            <span>Solana: ${solTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC (${solPercent}%)</span>
          </div>
          <p class="text-xs text-gray-500 mt-1">Last updated: ${data.lastUpdated}</p>
        </section>
  
        <!-- Race Calculation -->
        <section aria-labelledby="calc-heading">
          <h2 id="calc-heading" class="text-lg font-semibold text-gray-700 mb-2">Time to Catch Up</h2>
          <div class="mb-4">
            <label for="mint-rate" class="block text-sm font-medium text-gray-600">Solana Daily Mint Rate (BTC/day):</label>
            <input
              type="number"
              id="mint-rate"
              step="0.01"
              min="0"
              value="100"
              class="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
              aria-describedby="mint-rate-desc"
            >
            <p id="mint-rate-desc" class="text-xs text-gray-500 mt-1">Enter how much BTC Solana mints per day (excluding staking).</p>
          </div>
          <div class="mb-4">
            <label for="staked-sol" class="block text-sm font-medium text-gray-600">Staked SOL (SOL):</label>
            <input
              type="number"
              id="staked-sol"
              step="0.01"
              min="0"
              value="100000"
              class="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
              aria-describedby="staked-sol-desc"
            >
            <p id="staked-sol-desc" class="text-xs text-gray-500 mt-1">Enter amount of SOL staked (10% APY, rewards swapped to BTC).</p>
          </div>
          <div id="result" class="text-sm text-gray-600" aria-live="polite">
            <p>Calculating...</p>
          </div>
        </section>
      </main>
  
      <script>
        function calculateDays() {
          const ethTotal = ${ethTotal};
          const solTotal = ${solTotal};
          const mintRate = parseFloat(document.getElementById('mint-rate').value) || 0;
          const stakedSol = parseFloat(document.getElementById('staked-sol').value) || 0;
          const solBtcPrice = ${solBtcPrice};
          const resultDiv = document.getElementById('result');
  
          // Validate inputs
          if (mintRate < 0 || stakedSol < 0) {
            resultDiv.innerHTML = '<p class="text-red-600">Please enter non-negative values.</p>';
            return;
          }
  
          // Calculate staking rewards
          const dailyYield = 0.10 / 365; // 10% APY, daily
          const dailySolRewards = stakedSol * dailyYield;
          const stakingBtcPerDay = dailySolRewards * solBtcPrice;
          const totalBtcPerDay = mintRate + stakingBtcPerDay;
  
          // Check if Solana has caught up
          if (solTotal >= ethTotal) {
            resultDiv.innerHTML = '<p class="text-green-600">Solana has already caught up or surpassed Ethereum!</p>';
            return;
          }
  
          // Calculate days to catch up
          if (totalBtcPerDay <= 0) {
            resultDiv.innerHTML = '<p class="text-red-600">Total daily BTC growth must be positive.</p>';
            return;
          }
          const difference = ethTotal - solTotal;
          const days = Math.ceil(difference / totalBtcPerDay);
  
          // Calculate required SOL for mint rate in 1 year
          const annualBtcFromStaking = mintRate * 365; // BTC needed in 1 year
          const requiredSol = annualBtcFromStaking / (dailyYield * solBtcPrice * 365);
  
          resultDiv.innerHTML = \`
            <p>Daily SOL rewards: <span class="font-bold">\${dailySolRewards.toLocaleString('en-US', { maximumFractionDigits: 2 })} SOL</span> (\${stakingBtcPerDay.toLocaleString('en-US', { maximumFractionDigits: 6 })} BTC)</p>
            <p>Total daily BTC growth: <span class="font-bold">\${totalBtcPerDay.toLocaleString('en-US', { maximumFractionDigits: 6 })} BTC</span></p>
            <p>Solana needs approximately <span class="font-bold">\${days.toLocaleString('en-US')} days</span> to match Ethereum's \${ethTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC.</p>
            <p>To achieve \${mintRate.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC/day from staking alone in 1 year, stake <span class="font-bold">\${requiredSol.toLocaleString('en-US', { maximumFractionDigits: 0 })} SOL</span>.</p>
            <p class="text-xs text-gray-500 mt-1">Assumes 10% APY, SOL/BTC price of \${solBtcPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}, and static Ethereum supply.</p>
          \`;
        }
  
        // Initial calculation
        calculateDays();
  
        // Update on input change
        document.getElementById('mint-rate').addEventListener('input', calculateDays);
        document.getElementById('staked-sol').addEventListener('input', calculateDays);
  
        // Refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => {
          window.location.reload();
        });
      </script>
    </body>
    </html>
    `;
    return sanitizeHtml(html, {
      allowedTags: ['html', 'head', 'meta', 'title', 'style', 'body', 'main', 'header', 'section', 'div', 'h1', 'h2', 'p', 'span', 'button', 'input', 'label', 'script'],
      allowedAttributes: {
        meta: ['charset', 'name', 'content'],
        div: ['id', 'class', 'role', 'aria-label', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'style'],
        h1: ['role', 'aria-level'],
        h2: ['id', 'class'],
        p: ['id', 'class', 'aria-describedby'],
        button: ['id', 'class', 'aria-label'],
        input: ['id', 'type', 'step', 'min', 'value', 'class', 'aria-describedby'],
        label: ['for', 'class'],
        script: ['src'],
        section: ['aria-labelledby'],
        header: ['class'],
        span: ['class'],
      },
    });
  }

// === Main Handler ===
/** Cloudflare Worker handler */
export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const cacheKey = new Request(url, request);
        const cache = caches.default;
        let response = await cache.match(cacheKey);

        if (false && response) return response;

        try {
            const [ethArray, solArray, btcSupply, solBtcPrice] = await Promise.all([
                fetchEthereumSupplies(),
                fetchSolanaSupplies(),
                fetchBitcoinSupply(),
                fetchSolBtcPrice(),
            ]);

            const ethTotal = calculateTotal(ethArray);
            const solTotal = calculateTotal(solArray);
            const grandTotal = (parseFloat(ethTotal) + parseFloat(solTotal)).toFixed(8);

            const payload: ApiPayload = {
                ethereum: ethArray,
                solana: solArray,
                ethereumTotal: ethTotal,
                solanaTotal: solTotal,
                grandTotal,
                currentlyMintedBTC: btcSupply,
                lastUpdated: new Date().toLocaleString('en-US', { timeZone: 'UTC' }),
                solBtcPrice, // Added to payload
            };

            if (url.pathname === '/' || url.pathname === '/ui') {
                response = new Response(renderHtml(payload), {
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': `public, max-age=${CONFIG.CACHE_TTL}, s-maxage=${CONFIG.CACHE_TTL}`,
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            } else {
                response = new Response(JSON.stringify(payload), {
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': `public, max-age=${CONFIG.CACHE_TTL}, s-maxage=${CONFIG.CACHE_TTL}`,
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            }

            await cache.put(cacheKey, response.clone());
            return response;
        } catch (err) {
            console.error('Worker error:', err);
            return new Response(JSON.stringify({ error: 'Internal server error' }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }
    },
};