// chainUtils.js

const { updateUserLastAction } = require('./sessionUtils'); 
const { fetchJson, sanitizeInput, validateAddress } = require('./coreUtils');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Query function for CosmWasm contracts
async function queryCosmWasmContract(chainInfo, contractAddress, query) {
    const restAddress = sanitizeInput(chainInfo.data.restAddress).replace(/\/+$/, '');
    contractAddress = validateAddress(contractAddress); // Validate contract address
    const queryUrl = `${restAddress}/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${Buffer.from(JSON.stringify(query)).toString('base64')}`;
    return await fetchJson(queryUrl);
}

// Function to sort and find preferred blockchain explorer
function findPreferredExplorer(explorers) {
    if (!explorers || explorers.length === 0) return "Unknown";

    // Strip common prefixes for comparison purposes
    function stripPrefixes(name) {
        return name.replace(/^(http:\/\/|https:\/\/)?(www\.)?/, '');
    }

    // Define preference order
    const preferredOrder = ['c', 'm']; // Sort preference by these letters

    const sortedExplorers = explorers.map(explorer => {
        return {
            kind: explorer.kind,
            url: explorer.url,
            compareUrl: stripPrefixes(explorer.url)
        };
    }).sort((a, b) => {
        for (const letter of preferredOrder) {
            if (a.compareUrl.startsWith(letter) && b.compareUrl.startsWith(letter)) {
                return a.compareUrl.localeCompare(b.compareUrl);
            }
        }
        if (a.compareUrl.startsWith(preferredOrder[0])) return -1;
        if (b.compareUrl.startsWith(preferredOrder[0])) return 1;
        if (a.compareUrl.startsWith(preferredOrder[1])) return -1;
        if (b.compareUrl.startsWith(preferredOrder[1])) return 1;
        return a.compareUrl.localeCompare(b.compareUrl);
    });

    return sortedExplorers.length > 0 ? sortedExplorers[0].url : "Unknown";
}

//async function handlePriceInfo(ctx, tokenTicker) {
//    try {
//        const priceInfoUrl = `https://api.osmosis.zone/tokens/v2/price/${tokenTicker}`;
//        const response = await fetch(priceInfoUrl);
//        if (!response.ok) {
//            throw new Error('Error fetching price information.');
//        }
//        const priceData = await response.json();
//        let formattedResponse = `Token: ${tokenTicker.toUpperCase()}\n`;
//        formattedResponse += `Price: \`${priceData.price}\`\n`; // Formatting with backticks for monospace
//        formattedResponse += `24h Change: \`${priceData['24h_change']}%\``; // Adding '%' for clarity
//        await ctx.reply(formattedResponse, { parse_mode: 'Markdown' });
//    } catch (error) {
//        console.error('Error fetching price info:', error);
//        await ctx.reply('Error fetching price information. Please try again.');
//    }
//}

async function processPoolType(ctx, restAddress, poolId, chain) {
    const poolTypeUrl = `${restAddress}/osmosis/gamm/v1beta1/pools/${poolId}`;
    const poolTypeData = await fetchJson(poolTypeUrl);
    const poolType = poolTypeData.pool["@type"];

    if (poolType.includes("/osmosis.gamm.v1beta1.Pool") || poolType.includes("/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool")) {
        await handleGammPoolType(ctx, poolId, restAddress);
    } else if (poolType.includes("/osmosis.concentratedliquidity.v1beta1.Pool")) {
        await handleConcentratedLiquidityPoolType(ctx, restAddress, poolId);
    } else {
        ctx.reply('Unsupported pool type or no incentives available for this pool type.');
    }
}

async function handleGammPoolType(ctx, poolId, restAddress) {
    const url = `http://jasbanza.dedicated.co.za:7000/pool/${poolId}`;
    const rawData = await fetch(url);
    const jsonMatch = rawData.match(/<pre>([\s\S]*?)<\/pre>/);
    if (!jsonMatch || jsonMatch.length < 2) {
        throw new Error("No valid JSON found in the server's response.");
    }
    const data = JSON.parse(jsonMatch[1]);
    translateIncentiveDenoms(ctx, data);
}

async function translateIncentiveDenoms(ctx, data) {
    for (const incentive of data.data) {
        for (const coin of incentive.coins) {
            if (coin.denom.startsWith('ibc/')) {
                const ibcId = coin.denom.split('/')[1];
                coin.denom = await ibcId(ctx, ibcId, true);
            }
        }
    }
    const formattedPoolIncentivesResponse = formatPoolIncentivesResponse(data);
    ctx.reply(formattedPoolIncentivesResponse);
}

async function handleConcentratedLiquidityPoolType(ctx, restAddress, poolId) {
    const url = `${restAddress}/osmosis/concentratedliquidity/v1beta1/incentive_records?pool_id=${poolId}`;
    const data = await fetchJson(url);
    if (!data.incentive_records || data.incentive_records.length === 0) {
        ctx.reply('No incentives found.');
        return;
    }
    const incentives = await calculateIncentives(data);
    ctx.reply(JSON.stringify(incentives, null, 2));
}

async function calculateIncentives(data) {
    return data.incentive_records.map(record => {
        return formatIncentives(record);
    });
}

function formatIncentives(record) {
    const {
        incentive_id,
        incentive_record_body: {
            remaining_coin: { denom, amount },
            emission_rate,
            start_time
        }
    } = record;

    return {
        incentive_id,
        denom,
        amount_remaining: Number(amount).toFixed(2), // Ensure the amount is formatted to two decimal places
        emission_rate: Number(emission_rate).toFixed(2), // Format emission rate similarly
        time_remaining: calculateTimeRemaining(start_time)
    };
}

function calculateTimeRemaining(startTime) {
    // time remaining until incentives end
    const start = new Date(startTime);
    const now = new Date();
    const timeDiff = start.getTime() - now.getTime();
    
    // convert tfrom ms to days
    const daysRemaining = Math.floor(timeDiff / (1000 * 3600 * 24));

    // if calculated days are negative, start time has passed
    if (daysRemaining < 0) {
        return "Incentive period has ended";
    }

    return `${daysRemaining} days remaining`;
}

module.exports = {
    queryCosmWasmContract,
    findPreferredExplorer,
    processPoolType,
};
