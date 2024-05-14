const sessionUtils = require('./sessionUtils');
const coreUtils = require('./coreUtils');
const fs = require('fs');
const path = require('path');
const config = require('../config');

function constructChainInfoMessage(chainData, rpcAddress, restAddress, grpcAddress, evmHttpJsonRpcAddress, blockExplorerUrl, decimals, baseDenom) {
    return `Chain ID: \`${coreUtils.sanitizeString(chainData.chain_id)}\`\n` +
           `Chain Name: \`${coreUtils.sanitizeString(chainData.chain_name)}\`\n` +
           `RPC: \`${coreUtils.sanitizeUrl(rpcAddress)}\`\n` +
           `REST: \`${coreUtils.sanitizeUrl(restAddress)}\`\n` +
           `Address Prefix: \`${coreUtils.sanitizeString(chainData.bech32_prefix)}\`\n` +
           `Base Denom: \`${coreUtils.sanitizeString(baseDenom)}\`\n` +
           `Cointype: \`${coreUtils.sanitizeString(chainData.slip44)}\`\n` +
           `Decimals: \`${coreUtils.sanitizeString(decimals)}\`\n` +
           `Block Explorer: \`${coreUtils.sanitizeUrl(blockExplorerUrl)}\`\n`;
}

async function queryCosmWasmContract(chainInfo, contractAddress, query) {
    const restAddress = coreUtils.sanitizeUrl(chainInfo.data.restAddress).replace(/\/+$/, '');
    contractAddress = coreUtils.sanitizeString(contractAddress);
    const queryUrl = `${restAddress}/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${Buffer.from(JSON.stringify(query)).toString('base64')}`;
    return await coreUtils.fetchJson(queryUrl);
}

function findPreferredExplorer(explorers) {
    if (!explorers || explorers.length === 0) return "Unknown";

    function stripPrefixes(name) {
        return name.replace(/^(http:\/\/|https:\/\/)?(www\.)?/, '');
    }

    const preferredOrder = ['m', 'c'];

    const sortedExplorers = explorers.map(explorer => {
        return {
            kind: explorer.kind,
            url: explorer.url,
            compareUrl: stripPrefixes(explorer.url)
        };
    }).sort((a, b) => {
        for (const letter of preferredOrder) {
            if (a.compareUrl.startsWith(letter) && !b.compareUrl.startsWith(letter)) {
                return -1;
            }
            if (b.compareUrl.startsWith(letter) && !a.compareUrl.startsWith(letter)) {
                return 1;
            }
        }
        return a.compareUrl.localeCompare(b.compareUrl);
    });

    return sortedExplorers.length > 0 ? sortedExplorers[0].url : "Unknown";
}

const formatBlockExplorers = (explorers) => {
    if (!explorers || explorers.length === 0) return 'No block explorer data available.';

    const formattedExplorers = explorers.map(explorer => {
        const name = `*${coreUtils.sanitizeString(explorer.kind)}*`;
        const url = `\`${coreUtils.sanitizeUrl(explorer.url)}\``;
        return `${name}:\n${url}\n`;
    }).join('\n');

    const preferredExplorerUrl = findPreferredExplorer(explorers);
    const preferredExplorer = explorers.find(explorer => coreUtils.sanitizeUrl(explorer.url) === preferredExplorerUrl);

    const preferredExplorerSection = preferredExplorer ? `*Preferred Explorer*\n${'-'.repeat('Preferred Explorer'.length)}\n${formatService(preferredExplorer)}\n\n` : '';

    return `${preferredExplorerSection}${formattedExplorers}`;
};

async function processPoolType(ctx, restAddress, poolId, chain) {
    const poolTypeUrl = `${restAddress}/osmosis/gamm/v1beta1/pools/${poolId}`;
    const poolTypeData = await coreUtils.fetchJson(poolTypeUrl);
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
    const rawData = await coreUtils.fetch(url);
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
                coin.denom = await coreUtils.ibcId(ctx, ibcId, true);
            }
        }
    }
    const formattedPoolIncentivesResponse = formatPoolIncentivesResponse(data);
    ctx.reply(formattedPoolIncentivesResponse);
}

async function handleConcentratedLiquidityPoolType(ctx, restAddress, poolId) {
    const url = `${restAddress}/osmosis/concentratedliquidity/v1beta1/incentive_records?pool_id=${poolId}`;
    const data = await coreUtils.fetchJson(url);
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
        amount_remaining: Number(amount).toFixed(2),
        emission_rate: Number(emission_rate).toFixed(2),
        time_remaining: calculateTimeRemaining(start_time)
    };
}

function calculateTimeRemaining(startTime) {
    const start = new Date(startTime);
    const now = new Date();
    const timeDiff = start.getTime() - now.getTime();
    const daysRemaining = Math.floor(timeDiff / (1000 * 3600 * 24));
    return daysRemaining < 0 ? "Incentive period has ended" : `${daysRemaining} days remaining`;
}

async function handleChainInfo(ctx, userAction) {
    try {
        const chainInfoResult = await chainFuncs.chainInfo(ctx, userAction.chain);
        if (chainInfoResult && chainInfoResult.message) {
            await ctx.reply(chainInfoResult.message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } else {
            console.error('Unexpected result from chainInfo:', chainInfoResult);
            await ctx.reply('Failed to fetch chain info.');
        }
    } catch (error) {
        console.error('Error fetching chain info:', error);
        await ctx.reply('An error occurred while fetching chain info. Please try again later.');
    }
}

async function denomTracePoolIncentives(ctx, incentivesData, chain) {
    if (!incentivesData || !incentivesData.data) {
        console.error('Invalid incentives data:', incentivesData);
        return [];
    }
    for (const incentive of incentivesData.data) {
        for (const coin of incentive.coins) {
            if (coin.denom.startsWith('ibc/')) {
                const ibcId = coin.denom.split('/')[1];
                try {
                    const baseDenom = await coreUtils.ibcId(ctx, ibcId, chain, true);
                    coin.denom = baseDenom || coin.denom;
                } catch (error) {
                    console.error('Error translating IBC denom:', coin.denom, error);
                }
            }
        }
    }
    return formattedPoolIncentives(incentivesData);
}

function formatPoolIncentivesResponse(data) {
    if (!data || !Array.isArray(data.data) || data.data.length === 0) {
        return 'No incentives data available.';
    }

    let response = '';
    const currentDate = new Date();
    const filteredAndSortedData = data.data
        .filter(incentive => {
            const startTime = new Date(incentive.start_time);
            const durationDays = parseInt(incentive.num_epochs_paid_over, 10);
            const endTime = new Date(startTime.getTime() + durationDays * 24 * 60 * 60 * 1000);
            return startTime.getFullYear() !== 1970 && durationDays !== 1 && endTime > currentDate;
        })
        .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    if (filteredAndSortedData.length === 0) {
        return 'No current incentives available.';
    }

    filteredAndSortedData.forEach((incentive) => {
        const startTime = new Date(incentive.start_time);
        const durationDays = parseInt(incentive.num_epochs_paid_over, 10);
        const daysPassed = Math.floor((currentDate - startTime) / (1000 * 60 * 60 * 24));
        const remainingDays = durationDays - daysPassed > 0 ? durationDays - daysPassed : 0;

        response += `Start Time: ${startTime.toLocaleDateString()}\n`;
        response += `Duration: ${durationDays} days\n`;
        response += `Remaining Days: ${remainingDays}\n`;
        response += `Coin: ${incentive.coins.map(coin => `${coin.denom}\nAmount: ${coin.amount}`).join('\n')}\n\n`;
    });

    return response;
}

const formatPeers = (peers, title) => {
    if (!peers || peers.length === 0) return `*${title}*\nNo data available`;

    const formattedPeers = peers.map(peer => {
        // Regex to extract hostname and port, assuming address in 'host:port' format
        const match = peer.address.match(/([^:]+)(?::(\d+))?$/);
        const address = match ? match[1] : 'unknown';
        const port = match ? match[2] : 'unknown';
        return `${coreUtils.sanitizeString(peer.provider)}\n\`${peer.id}@${address}:${port}\``; // format as 'id@address:port'
    }).join('\n\n');

    return `*${title}*\n\n${formattedPeers}`;
};

function formatService(service) {
    const provider = `*${coreUtils.sanitizeString(service.provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_'))}*`;
    const address = `\`${coreUtils.sanitizeUrl(service.address.replace(/\/$/, '').replace(/_/g, '\\_'))}\``;
    return `${provider}:\n${address}\n`;
}

function formatEndpoints(services, title, maxEndpoints) {
    if (!services || services.length === 0) {
        return `*${title}*\nNo data available\n`;
    }
    return services.slice(0, maxEndpoints).map(formatService).join("\n");
}

async function formatPoolInfo(ctx, poolData, chain) {
    if (!poolData || !poolData.pool) {
        console.error('Invalid pool data:', poolData);
        return 'Error: Pool data is not available or malformed.';
    }
    let formattedResponse = '';
    const poolType = poolData.pool["@type"];

    const chainInfoResult = await chainFuncs.chainInfo(ctx, chain);
    console.log('chainInfoResult:', chainInfoResult);

    if (!chainInfoResult || typeof chainInfoResult !== 'object' || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        console.error('chainInfoResult is not structured as expected or missing necessary data:', chainInfoResult);
        return 'Error: Failed to retrieve or validate chain information. Please check the server logs for details.';
    }

    try {
        if (poolType.includes("/osmosis.gamm.v1beta1.Pool") || poolType.includes("/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool")) {
            formattedResponse += `Pool Type: Gamm Pool\n`;
            formattedResponse += `ID: ${coreUtils.sanitizeString(poolData.pool.id)}\n`;
            formattedResponse += `Address: ${coreUtils.sanitizeString(poolData.pool.address)}\n`;
            formattedResponse += `Swap Fee: ${coreUtils.sanitizeString(poolData.pool.pool_params.swap_fee)}\n`;
            formattedResponse += `Exit Fee: ${coreUtils.sanitizeString(poolData.pool.pool_params.exit_fee)}\n`;

            for (const asset of poolData.pool.pool_assets) {
                const baseDenom = await queryIbcId(ctx, coreUtils.sanitizeString(asset.token.denom.split('/')[1]), chain, true);
                formattedResponse += `Token: ${baseDenom || coreUtils.sanitizeString(asset.token.denom)}\n`;
                formattedResponse += `[denom:\`${coreUtils.sanitizeString(asset.token.denom)}\`]\n`;
            }
        } else if (poolType.includes("/osmosis.concentratedliquidity.v1beta1.Pool")) {
            formattedResponse += `Pool Type: Concentrated Liquidity Pool\n`;
            formattedResponse += `ID: ${coreUtils.sanitizeString(poolData.pool.id)}\n`;
            formattedResponse += `Address: ${coreUtils.sanitizeString(poolData.pool.address)}\n`;
            formattedResponse += `Swap Fee: ${coreUtils.sanitizeString(poolData.pool.spread_factor)}\n`;

            const tokens = [coreUtils.sanitizeString(poolData.pool.token0), coreUtils.sanitizeString(poolData.pool.token1)];
            for (const token of tokens) {
                const baseDenom = await queryIbcId(ctx, token.split('/')[1], chain, true);
                formattedResponse += `Token: ${baseDenom || coreUtils.sanitizeString(token)}\n`;
            }
        } else if (poolType.includes("/osmosis.cosmwasmpool.v1beta1.CosmWasmPool")) {
            const contractAddress = coreUtils.sanitizeString(poolData.pool.contract_address);
            const configResponse = await queryCosmWasmContract(ctx, chainInfoResult.data.restAddress, contractAddress, {"get_config": {}});
            const swapFeeResponse = await queryCosmWasmContract(ctx, chainInfoResult.data.restAddress, contractAddress, {"get_swap_fee": {}});
            const totalLiquidityResponse = await queryCosmWasmContract(ctx, chainInfoResult.data.restAddress, contractAddress, {"get_total_pool_liquidity": {}});
            formattedResponse += `Pool Type: CosmWasm Pool\nContract Address: ${coreUtils.sanitizeString(contractAddress)}\nSwap Fee: ${coreUtils.sanitizeString(swapFeeResponse.swap_fee)}\nConfig: ${JSON.stringify(configResponse)}\n`;
            totalLiquidityResponse.total_pool_liquidity.forEach(asset => {
                formattedResponse += `Token: ${coreUtils.sanitizeString(asset.denom)}\nAmount: ${coreUtils.sanitizeString(asset.amount)}\n`;
            });
        } else {
            return 'Unsupported pool type or format.';
        }
    } catch (error) {
        console.error('Error processing pool info:', error);
        return 'Error processing pool information. Please check logs for details.';
    }

    return formattedResponse;
}

module.exports = {
    constructChainInfoMessage,
    queryCosmWasmContract,
    findPreferredExplorer,
    processPoolType,
    handleChainInfo,
    denomTracePoolIncentives,
    formatPoolIncentivesResponse,
    formatPoolInfo,
    formatPeers,
    formatService,
    formatEndpoints,
    formatBlockExplorers,
};
