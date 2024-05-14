const { readFile } = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const chainUtils = require('../utils/chainUtils');
const coreUtils = require('../utils/coreUtils');
const { getUserLastAction, getHealthyEndpoints, setHealthyEndpoints } = require('../utils/sessionUtils');
const config = require('../config');

async function checkChainHealth(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Checking health for chain: ${chain}`);
    try {
        const directory = path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = await readFile(chainJsonPath, 'utf8').then(JSON.parse).catch(() => null);

        if (!chainData) {
            throw new Error(`Data for ${chain} is missing or corrupt.`);
        }

        let cachedEndpoints = getHealthyEndpoints(chain);
        if (cachedEndpoints) {
            console.log(`Using cached endpoints for chain: ${chain}`);
        } else {
            console.log(`No cached endpoints for chain: ${chain}, checking health...`);
            cachedEndpoints = {
                rpc: await coreUtils.findHealthyEndpoint(ctx, chainData, 'rpc'),
                rest: await coreUtils.findHealthyEndpoint(ctx, chainData, 'rest')
            };
            setHealthyEndpoints(chain, cachedEndpoints);
        }

        return cachedEndpoints;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in checkChainHealth for ${chain}: ${error.message}`);
        console.error(error.stack);
        return null;
    }
}

async function chainInfo(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Starting chainInfo for chain: ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = getUserLastAction(userId);
        if (!userAction) {
            throw new Error('No user action found.');
        }

        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const assetListPath = path.join(directory, 'assetlist.json');
        const chainJsonPath = path.join(directory, 'chain.json');

        console.log(`Reading asset list from ${assetListPath}`);
        const assetData = await readFile(assetListPath, 'utf8').then(JSON.parse).catch(() => null);
        console.log(`Reading chain data from ${chainJsonPath}`);
        const chainData = await readFile(chainJsonPath, 'utf8').then(JSON.parse).catch(() => null);

        if (!assetData || !chainData) {
            throw new Error(`Data for ${chain} is missing or corrupt.`);
        }

        // Use cached endpoints
        const cachedEndpoints = getHealthyEndpoints(chain);
        if (!cachedEndpoints) {
            throw new Error('No cached endpoints found.');
        }

        const baseDenom = chainData.staking?.staking_tokens?.[0]?.denom || "Unknown";
        const nativeDenomExponent = assetData.assets?.[0]?.denom_units?.slice(-1)[0];
        const decimals = nativeDenomExponent ? nativeDenomExponent.exponent : "Unknown";
        const rpcAddress = cachedEndpoints.rpc;
        const restAddress = cachedEndpoints.rest;
        const grpcAddress = chainData.apis?.grpc?.find(api => api.address)?.address || "Unknown";
        const evmHttpJsonRpcAddress = chainData.apis?.['evm-http-jsonrpc']?.find(api => api.address)?.address || "Unknown";
        const blockExplorerUrl = coreUtils.findPreferredExplorer(chainData.explorers);

        const healthWarning = (rpcAddress === "Unknown" && restAddress === "Unknown") ? "\nWarning: RPC and REST endpoints may be out of sync or offline." : "";
        const message = chainUtils.constructChainInfoMessage(chainData, rpcAddress, restAddress, grpcAddress, evmHttpJsonRpcAddress, blockExplorerUrl, decimals, baseDenom) + healthWarning;
        console.log(`Chain info message: ${message}`);

        await ctx.replyWithMarkdown(message);

        return { message, data: { rpcAddress, restAddress, grpcAddress, evmHttpJsonRpcAddress, blockExplorerUrl, decimals } };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in chainInfo for ${chain}: ${error.message}`);
        console.error(error.stack);
        await ctx.reply(`Error fetching data for ${chain}.`);
        return `Error fetching data for ${chain}.`;
    }
}

async function chainEndpoints(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching endpoints for ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = getUserLastAction(userId);
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = await readFile(chainJsonPath, 'utf8').then(JSON.parse).catch(() => null);

        if (!chainData) {
            console.error(`Data file for ${chain} is missing or invalid.`);
            await ctx.reply(`Error fetching endpoints for ${chain}. Data file is missing or invalid.`);
            return;
        }

        let responseSections = [
            `*RPC*\n---\n${chainUtils.formatEndpoints(chainData.apis.rpc, "RPC", 5)}`,
            `*REST*\n---\n${chainUtils.formatEndpoints(chainData.apis.rest, "REST", 5)}`,
            `*GRPC*\n---\n${chainUtils.formatEndpoints(chainData.apis.grpc, "GRPC", 5)}`
        ];

        if (chainData.apis['evm-http-jsonrpc']) {
            responseSections.push(`*EVM-HTTP-JSONRPC*\n---\n${chainUtils.formatEndpoints(chainData.apis['evm-http-jsonrpc'], "EVM-HTTP-JSONRPC", 5)}`);
        }

        let response = responseSections.filter(section => !section.includes("No data available")).join("\n\n").trim();

        console.log(`Response to be sent: ${response.substring(0, 50)}...`); // Log a preview of the response

        // Send the response, handle message length exceeding Telegram's limit if necessary
        if (response.length > 4096) {
            console.log('Response is too long, sending in parts.');
            // Split response into parts and send if necessary (implementation not shown)
        } else {
            await ctx.replyWithMarkdown(coreUtils.escapeMarkdown(response));
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching endpoints for ${chain}: ${error.message}`, error.stack);
        await ctx.reply(`Error fetching endpoints for ${chain}. Please try again.`);
    }
}

async function chainPeerNodes(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching peer nodes for ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = getUserLastAction(userId);
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = await readFile(chainJsonPath, 'utf8').then(JSON.parse).catch(() => null);

        if (!chainData || !chainData.peers) {
            console.error(`Peer data for ${chain} is missing or invalid.`);
            await ctx.reply(`Error fetching peer nodes for ${chain}. Data file is missing or invalid.`);
            return;
        }

        const sanitizeString = coreUtils.sanitizeString;
        const sanitizeUrl = coreUtils.sanitizeUrl;

        const seeds = chainData.peers.seeds?.map(peer => {
            const address = peer.address ? peer.address.replace(/[_]/g, '\\_') : 'unknown';
            const id = peer.id ? peer.id.replace(/[_]/g, '\\_') : 'unknown';
            return `*${sanitizeString(peer.provider)}*\n\`${id}@${address}\``;
        }).join('\n\n') || 'No data available';

        const persistentPeers = chainData.peers.persistent_peers?.map(peer => {
            const address = peer.address ? peer.address.replace(/[_]/g, '\\_') : 'unknown';
            const id = peer.id ? peer.id.replace(/[_]/g, '\\_') : 'unknown';
            return `*${sanitizeString(peer.provider)}*\n\`${id}@${address}\``;
        }).join('\n\n') || 'No data available';

        await ctx.replyWithMarkdown(`*Seed Nodes*\n${seeds}\n\n*Persistent Peers*\n${persistentPeers}`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching peer nodes for ${chain}: ${error.message}`);
        console.error(error.stack);
        await ctx.reply(`Error fetching peer nodes for ${chain}. Please try again.`);
    }
}

async function chainBlockExplorers(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching block explorers for ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = getUserLastAction(userId);
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainDataRaw = await readFile(chainJsonPath, 'utf8');
        const chainData = JSON.parse(chainDataRaw);

        if (!chainData.explorers || chainData.explorers.length === 0) {
            await ctx.reply('No block explorer data available.');
            return;
        }

        const explorers = chainData.explorers.map(explorer => {
            const kind = coreUtils.sanitizeString(explorer.kind);
            const url = coreUtils.sanitizeUrl(explorer.url);
            return `*${kind}*\n\`${url}\``;
        }).join('\n\n');

        await ctx.replyWithMarkdown(explorers);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching block explorers for ${chain}: ${error.message}`);
        console.error(error.stack);
        await ctx.reply(`Error fetching block explorers for ${chain}. Please try again.`);
    }
}

async function poolInfo(ctx, poolId) {
    const userId = ctx.from.id.toString();
    const userAction = getUserLastAction(userId);
    if (!userAction || userAction.chain !== 'osmosis') {
        await ctx.reply('The "Pool Info" feature is only available for the Osmosis chain.');
        return;
    }

    try {
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
        if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
            await ctx.reply('Error: Healthy REST address not found for the selected chain.');
            return;
        }

        let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
        const poolTypeUrl = `${restAddress}/osmosis/gamm/v1beta1/pools/${poolId}`;
        const response = await fetch(poolTypeUrl);
        if (!response.ok) {
            throw new Error('Error fetching pool information.');
        }
        const poolData = await response.json();
        const formattedResponse = await chainUtils.formatPoolInfo(ctx, poolData, userAction.chain);
        await ctx.reply(formattedResponse);
    } catch (error) {
        console.error('Error fetching pool info:', error);
        await ctx.reply('Error fetching pool information. Please try again.');
    }
}

async function poolIncentives(ctx, poolId) {
    const userId = ctx.from.id.toString();
    const userAction = getUserLastAction(userId);

    if (!userAction || !userAction.chain) {
        await ctx.reply('No chain selected. Please select a chain first.');
        return;
    }

    try {
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
        if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
            await ctx.reply('Error: Healthy REST address not found for the selected chain.');
            return;
        }

        let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
        await chainUtils.processPoolType(ctx, restAddress, poolId, userAction.chain);
    } catch (error) {
        console.error('Error processing pool incentives:', error);
        await ctx.reply('Error processing request. Please try again.');
    }
}

async function walletBalances(ctx, chain, walletAddress) {
    const chainInfoResult = await chainInfo(ctx, chain);
    if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        ctx.reply('Error: REST address not found for the selected chain.');
        return;
    }

    const restAddress = await coreUtils.findHealthyEndpoint(ctx, chainData, 'rest');
    const url = `${restAddress}/cosmos/bank/v1beta1/balances/${walletAddress}`;

    try {
        const response = await fetch(url);
        const balanceData = await response.json();

        if (!balanceData.balances) {
            ctx.reply('No balances found for the provided wallet address.');
            return;
        }

        let balanceMessage = `Wallet Balances for ${walletAddress}:\n`;
        for (const balance of balanceData.balances) {
            let denom = balance.denom;
            if (denom.startsWith('ibc/')) {
                const ibcHash = denom.split('/')[1];
                const denomTrace = await ibcIdRaw(ctx, ibcHash, chain);
                denom = denomTrace ? `${denomTrace.base_denom} (via ${denomTrace.path})` : denom;
            }
            balanceMessage += `${balance.amount} ${denom}\n`;
        }

        // Only sanitize the display string
        balanceMessage = coreUtils.sanitizeString(balanceMessage);
        ctx.reply(balanceMessage);
    } catch (error) {
        console.error('Error fetching wallet balances:', error);
        ctx.reply('Error fetching wallet balances. Please try again.');
    }
}

async function fetchIbcDenomTrace(restAddress, ibcHash) {
    const url = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcHash}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.denom_trace) {
            return data.denom_trace;
        } else {
            throw new Error('No IBC Denom Trace found.');
        }
    } catch (error) {
        console.error('Error fetching IBC denom trace:', error);
        throw error;
    }
}

async function ibcIdFormatted(ctx, ibcHash, chain) {
    const cachedEndpoints = getHealthyEndpoints(chain);
    if (!cachedEndpoints || !cachedEndpoints.rest) {
        throw new Error(`No healthy REST endpoint available for chain ${chain}`);
    }

    const restAddress = cachedEndpoints.rest.replace(/\/+$/, '');
    try {
        const denomTrace = await fetchIbcDenomTrace(restAddress, ibcHash);
        const message = `IBC Denom Trace: \nBase Denom: ${coreUtils.sanitizeString(denomTrace.base_denom)}\nPath: ${coreUtils.sanitizeString(denomTrace.path)}`;
        ctx.reply(message);
        return denomTrace.base_denom;
    } catch (error) {
        ctx.reply('Error fetching IBC denom trace. Please try again.');
        throw new Error('Error fetching IBC denom trace.');
    }
}

async function ibcIdRaw(ctx, ibcHash, chain) {
    const cachedEndpoints = getHealthyEndpoints(chain);
    if (!cachedEndpoints || !cachedEndpoints.rest) {
        throw new Error(`No healthy REST endpoint available for chain ${chain}`);
    }

    const restAddress = cachedEndpoints.rest.replace(/\/+$/, '');
    try {
        const denomTrace = await fetchIbcDenomTrace(restAddress, ibcHash);
        return denomTrace;
    } catch (error) {
        ctx.reply('Error fetching IBC denom trace. Please try again.');
        return null;
    }
}

module.exports = {
    chainInfo,
    chainEndpoints,
    chainPeerNodes,
    chainBlockExplorers,
    poolInfo,
    poolIncentives,
    walletBalances,
    ibcIdFormatted,
    ibcIdRaw,
    checkChainHealth,
};
