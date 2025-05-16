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