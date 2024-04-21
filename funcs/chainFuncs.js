// chainFuncs.js

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../config');
const sessionUtils = require('../utils/sessionUtils');

async function chainInfo(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Starting chainInfo for chain: ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.userLastAction[userId]; // Use sessionUtils for session data
        if (!userAction) {
            throw new Error('No user action found.');
        }

        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');

        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));
        if (!chainData) {
            throw new Error(`Data for ${chain} is missing or corrupt.`);
        }

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

async function chainEndpoints(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching endpoints for ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.userLastAction[userId]; // Use sessionUtils for session data
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');

        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));
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

async function chainPeerNodes(ctx, chain) {
    try {
        const userId = ctx.from.id.toString(); // Ensure user ID is a string
        const userAction = sessionUtils.userLastAction[userId]; // Use sessionUtils for session data
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

async function chainBlockExplorers(ctx, chain) {
    try {
        const userId = ctx.from.id.toString(); // Ensure user ID is a string
        const userAction = sessionUtils.userLastAction[userId]; // Use sessionUtils for session data
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        return formatBlockExplorers(chainData.explorers);
    } catch (error) {
        console.error(`Error fetching block explorers for ${chain}: ${error}`);
        return `Error fetching block explorers for ${chain}. Please contact developer or open an issue on Github.`;
    }
}

async function poolInfo(ctx, poolId) {
    const userId = ctx.from.id.toString(); // Ensure string
    const userAction = sessionUtils.userLastAction[userId];
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
    const userAction = sessionUtils.userLastAction[userId];

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

module.exports = {
    chainInfo,
    chainEndpoints,
    chainPeerNodes,
    chainBlockExplorers,
    poolInfo,
    poolIncentives
};
