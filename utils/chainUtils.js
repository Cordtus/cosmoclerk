// chainUtils.js

const { userLastAction, updateUserLastAction } = require('./sessionUtils');
const { isEndpointHealthy, fetchJson, sanitizeString, sanitizeInput, validateAddress, escapeMarkdown } = require('./coreUtils');
const { readFileSafely } = require ('./repoUtils');
const { formatPoolInfo } = require ('../funcs/infoFuncs');
const fs = require('fs');
const path = require('path');
const config = require('../config');


// Function to fetch directories based on the chain
async function getChainDirectories(userAction) {
    const baseDirectory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets') : config.repoDir;
    const directory = path.join(baseDirectory, userAction.chain);
    return {
        assetListPath: path.join(directory, 'assetlist.json'),
        chainJsonPath: path.join(directory, 'chain.json')
    };
}

// Query function for CosmWasm contracts
async function queryCosmWasmContract(chainInfo, contractAddress, query) {
    const restAddress = sanitizeInput(chainInfo.data.restAddress).replace(/\/+$/, '');
    contractAddress = validateAddress(contractAddress); // Validate contract address
    const queryUrl = `${restAddress}/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${Buffer.from(JSON.stringify(query)).toString('base64')}`;
    return await fetchJson(queryUrl);
}

// Example usage in a function, integrating these utilities
async function chainInfo(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Starting chainInfo for chain: ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = userLastAction[userId];
        if (!userAction) {
            throw new Error('No user action found.');
        }

        // Log the directories being accessed for further context
        const { assetListPath, chainJsonPath } = await getChainDirectories(userAction);
        console.log(`Asset list path: ${assetListPath}`);
        console.log(`Chain JSON path: ${chainJsonPath}`);

        const assetData = readFileSafely(assetListPath);
        const chainData = readFileSafely(chainJsonPath);

        // Check if the data has been correctly read
        if (!assetData || !chainData) {
            throw new Error(`Data for ${chain} is missing or corrupt.`);
        }

        // Log data to see if it's as expected
        console.log(`Asset Data for ${chain}:`, assetData);
        console.log(`Chain Data for ${chain}:`, chainData);

        const rpcAddress = await findHealthyEndpoint(ctx, chainData, 'rpc') || "Unavailable";
        const restAddress = await findHealthyEndpoint(ctx, chainData, 'rest') || "Unavailable";
        const grpcAddress = chainData.apis?.grpc?.find(api => api.address)?.address || "Unknown";
        const evmHttpJsonRpcAddress = chainData.apis?.['evm-http-jsonrpc']?.find(api => api.address)?.address || null;
        const blockExplorerUrl = findPreferredExplorer(chainData.explorers);

        const healthWarning = (rpcAddress === "Unavailable" && restAddress === "Unavailable") ? "\nWarning: RPC and REST endpoints may be out of sync or offline." : "";
        const message = constructChainInfoMessage(chainData, rpcAddress, restAddress, grpcAddress, evmHttpJsonRpcAddress, blockExplorerUrl) + healthWarning;
        console.log(`Chain info message: ${message}`);

        return { message, data: { rpcAddress, restAddress, grpcAddress, evmHttpJsonRpcAddress, blockExplorerUrl } };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in chainInfo for ${chain}: ${error.message}`);
        console.error(error.stack);
        return `Error fetching data for ${chain}.`;
    }
}

function constructChainInfoMessage(chainData, rpcAddress, restAddress, grpcAddress, evmHttpJsonRpcAddress, blockExplorerUrl) {
    let message = `Chain ID: \`${chainData.chain_id}\`\n` +
        `Chain Name: \`${chainData.chain_name}\`\n` +
        `RPC: \`${rpcAddress}\`\n` +
        `REST: \`${restAddress}\`\n` +
        `GRPC: \`${grpcAddress}\`\n`;
    if (evmHttpJsonRpcAddress) {
        message += `EVM-RPC: \`${evmHttpJsonRpcAddress}\`\n`;
    }
    message += `Explorer: \`${blockExplorerUrl}\`\n`;
    return message;
}

async function findHealthyEndpoint(ctx, chainData, type) {
    console.log(`Checking health for endpoints of type: ${type}`);
    if (!chainData.apis || !chainData.apis[type]) {
        console.log(`No endpoints found for type: ${type}`);
        return "Unknown"; // Return "Unknown" if no endpoints of this type exist
    }

    for (const endpoint of chainData.apis[type]) {
        try {
            if (await isEndpointHealthy(endpoint.address, type)) {
                return endpoint.address;
            }
        } catch (error) {
            console.error(`Failed to check health for endpoint: ${endpoint.address}`, error);
        }
    }
    return "Unknown"; // Return "Unknown" if no healthy endpoint found
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

async function chainEndpoints(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching endpoints for ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = readFileSafely(chainJsonPath);

        if (!chainData) {
            console.error(`Error: Data file for ${chain} is missing or invalid.`);
            await ctx.reply(`Error fetching endpoints for ${chain}. Data file is missing or invalid.`);
            return;
        }

        const formattedEndpoints = formatEndpoints(chainData, 3); // Limiting to top 3 entries per endpoint type
        const response = formattedEndpoints.join("\n\n").trim();
        console.log(`Response to be sent (preview): ${response.substring(0, 50)}...`);

        if (response.length > 4096) {
            console.log('Response is too long, sending in parts.');
            let partIndex = 0;
            while (partIndex < response.length) {
                const part = response.substring(partIndex, Math.min(partIndex + 4096, response.length));
                await ctx.replyWithMarkdown(part);
                partIndex += 4096;
            }
        } else {
            await ctx.replyWithMarkdown(response);
        }
    } catch (error) {
        console.error(`Error fetching endpoints for ${chain}: ${error}`);
        await ctx.reply(`Error fetching endpoints for ${chain}. Please try again.`);
    }
}

function formatEndpoints(chainData, maxEntriesPerType = 5) {
    const apiTypes = ["rpc", "rest", "grpc", "evm-http-jsonrpc"];
    return apiTypes.reduce((sections, apiType) => {
        if (chainData.apis[apiType] && chainData.apis[apiType].length > 0) {
            const formattedSection = formatEndpointSection(apiType.toUpperCase(), chainData.apis[apiType], maxEntriesPerType);
            sections.push(formattedSection);
        }
        return sections;
    }, []);
}

function formatEndpointSection(title, services, maxEntries) {
    const formattedServices = services.slice(0, maxEntries).map(service => {
        const provider = sanitizeString(service.provider);
        const address = `\`${service.address}\``;
        return `*${provider}*:\n${address}\n`;
    }).join("\n");
    return `*${title}*\n---\n${formattedServices}`;
}

async function chainPeerNodes(ctx, chain) {
    try {
        const userId = ctx.from.id.toString(); // Ensure user ID is a string
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const seedsHeader = "Seed Nodes";
        const peersHeader = "Peer Nodes";
        const seeds = formatPeers(chainData.peers.seeds, seedsHeader);
        const persistentPeers = formatPeers(chainData.peers.persistent_peers, peersHeader);

        return `${seeds}${persistentPeers}`;
    } catch (error) {
        console.error(`Error fetching peer nodes for ${chain}: ${error}`);
        return `Error fetching peer nodes for ${chain}. Please contact developer...`;
    }
}

function formatPeers(peers, title) {
    if (!peers || peers.length === 0) return `*${title}*\nNo data available\n\n`;
    return peers.map(peer => formatPeer(peer)).join("\n");
}

function formatPeer(peer) {
    const provider = sanitizeString(peer.provider || 'unnamed');
    const id = peer.id ? `id: \`${peer.id}\`` : 'id: unavailable';
    const address = peer.address ? `URL: \`${peer.address}\`` : 'URL: unavailable';
    return `*${provider}*\n${id}\n${address}\n`;
}

async function chainBlockExplorers(ctx, chain) {
    try {
        const userId = ctx.from.id.toString(); // Ensure user ID is a string
        const userAction = userLastAction[userId];
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        return formatBlockExplorers(chainData.explorers);
    } catch (error) {
        console.error(`Error fetching block explorers for ${chain}: ${error}`);
        return `Error fetching block explorers for ${chain}. Please contact developer or open an issue on Github.`;
    }
}

function formatBlockExplorers(explorers) {
    if (!explorers || explorers.length === 0) return 'No block explorers available.';
    return explorers.map(explorer => formatExplorer(explorer)).join('\n');
}

function formatExplorer(explorer) {
    const kind = sanitizeString(explorer.kind);
    const url = escapeMarkdown(explorer.url);
    return `*${kind}*: \`${url}\``;
}

async function ibcId(ctx, ibcId, chain, returnBaseDenom = false) {
    const chainInfoResult = await chainInfo(ctx, chain);
    if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        if (returnBaseDenom) return '';
        ctx.reply('Error: REST address not found for the selected chain.');
        return;
    }

    let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
    const url = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcId}`;
    try {
        const response = await fetchJson(url);
        const data = await response.json();
        if (returnBaseDenom) {
            return data.denom_trace ? data.denom_trace.base_denom : ibcId;
        } else {
            ctx.reply(`IBC Denom Trace: \n${JSON.stringify(data.denom_trace, null, 2)}`);
        }
    } catch (error) {
        console.error('Error fetching IBC denom trace:', error);
        if (returnBaseDenom) return ''; // Return empty string for further processing
        ctx.reply('Error fetching IBC denom trace. Please try again.');
    }
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

async function poolInfo(ctx, poolId) {
    const userId = ctx.from.id.toString(); // Ensure string
    const userAction = userLastAction[userId];
    if (!userAction || userAction.chain !== 'osmosis') {
        await ctx.reply('The "Pool Info" feature is only available for the Osmosis chain.');
        return;
    }

    try {
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
        if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
            ctx.reply('Error: Healthy REST address not found for the selected chain.');
            return;
        }

        let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
        const poolTypeUrl = `${restAddress}/osmosis/gamm/v1beta1/pools/${poolId}`;
        const response = await fetch(poolTypeUrl);
        if (!response.ok) {
            throw new Error('Error fetching pool information.');
        }
        const poolData = await response.json();
        const poolType = poolData.pool["@type"];
        const formattedResponse = await formatPoolInfo(ctx, poolData, userAction.chain);
        ctx.reply(formattedResponse);
    } catch (error) {
        console.error('Error fetching pool info:', error);
        ctx.reply('Error fetching pool information. Please try again.');
    }
}

async function poolIncentives(ctx, poolId) {
    const userId = ctx.from.id.toString();
    const userAction = userLastAction[userId];

    if (!userAction || !userAction.chain) {
        await ctx.reply('No chain selected. Please select a chain first.');
        return;
    }

    try {
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
        if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
            ctx.reply('Error: Healthy REST address not found for the selected chain.');
            return;
        }

        let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
        await processPoolType(ctx, restAddress, poolId, userAction.chain);
    } catch (error) {
        console.error('Error processing pool incentives:', error);
        ctx.reply('Error processing request. Please try again.');
    }
}

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
        return formatIncentive(record);
    });
}

function formatIncentive(record) {
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
    chainInfo,
    chainEndpoints,
    chainBlockExplorers,
    chainPeerNodes,
    findHealthyEndpoint,
    chainEndpoints,
    chainPeerNodes,
    chainBlockExplorers,
    ibcId,
    poolInfo,
    poolIncentives,
    processPoolType,
};
