// chainFuncs.js

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../config');
const sessionUtils = require('../utils/sessionUtils');
const coreUtils = require('../utils/coreUtils');
const chainUtils = require('../utils/chainUtils');

async function chainInfo(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Starting chainInfo for chain: ${chain}`);
    try {
        const userId = ctx.from.id.toString();
        const userAction = sessionUtils.userLastAction[userId];
        if (!userAction) {
            throw new Error('No user action found.');
        }

        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));
        if (!chainData) {
            throw new Error(`Data for ${chain} is missing or corrupt.`);
        }

        const rpcAddress = await coreUtils.findHealthyEndpoint(ctx, chainData, 'rpc') || "Unavailable";
        const restAddress = await coreUtils.findHealthyEndpoint(ctx, chainData, 'rest') || "Unavailable";
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
    const userId = ctx.from.id.toString();
    const userAction = sessionUtils.userLastAction[userId];
    const directory = userAction.browsingTestnets ? 
                      path.join(config.repoDir, 'testnets', chain) : 
                      path.join(config.repoDir, chain);
    const chainJsonPath = path.join(directory, 'chain.json');
    const chainData = JSON.parse(await fs.promises.readFile(chainJsonPath, 'utf8'));

    if (!chainData) {
        console.error(`Data file for ${chain} is missing or invalid.`);
        await ctx.reply(`Error fetching endpoints for ${chain}. Data file is missing or invalid.`);
        return;
    }

    let response = coreUtils.formatEndpoints(chainData.apis, "RPC", 5); // Adjust to include other types like REST, GRPC based on your old logic
    await ctx.replyWithMarkdown(response);
}

async function chainPeerNodes(ctx, chain) {
    const userId = ctx.from.id.toString();
    const userAction = sessionUtils.userLastAction[userId];
    const directory = userAction.browsingTestnets ? 
                      path.join(config.repoDir, 'testnets', chain) : 
                      path.join(config.repoDir, chain);
    const chainJsonPath = path.join(directory, 'chain.json');
    try {
        const chainData = JSON.parse(await fs.promises.readFile(chainJsonPath, 'utf8'));
        if (!chainData.peers) {
            await ctx.reply('No peer data available for this chain.');
            return;
        }
        const seeds = coreUtils.formatPeers(chainData.peers.seeds, "Seed Nodes");
        const persistentPeers = coreUtils.formatPeers(chainData.peers.persistent_peers, "Peer Nodes");
        await ctx.replyWithMarkdown(`${seeds}\n${persistentPeers}`);
    } catch (error) {
        console.error(`Error fetching peer nodes for ${chain}: ${error}`);
        await ctx.reply(`Error fetching peer nodes for ${chain}. Please check the configuration or contact developer.`);
    }
}

async function chainBlockExplorers(ctx, chain) {
    try {
        const userId = ctx.from.id.toString(); // Ensure user ID is a string
        const userAction = sessionUtils.userLastAction[userId]; // Use sessionUtils for session data
        const directory = userAction.browsingTestnets ? path.join(config.repoDir, 'testnets', chain) : path.join(config.repoDir, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        
        // Asynchronous read of the JSON file
        const chainDataRaw = await fs.promises.readFile(chainJsonPath, 'utf8');
        const chainData = JSON.parse(chainDataRaw);

        if (!chainData.explorers || chainData.explorers.length === 0) {
            return 'No block explorer data available.';
        }

        return formatBlockExplorers(chainData.explorers);
    } catch (error) {
        console.error(`Error fetching block explorers for ${chain}: ${error.message}`);
        return `Error fetching block explorers for ${chain}. Please check the configuration or contact developer.`;
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
        const formattedResponse = await formatPoolInfo(ctx, poolData, userAction.chain);
        await ctx.reply(formattedResponse);
    } catch (error) {
        console.error('Error fetching pool info:', error);
        await ctx.reply('Error fetching pool information. Please try again.');
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
            await ctx.reply('Error: Healthy REST address not found for the selected chain.');
            return;
        }

        let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
        await processPoolType(ctx, restAddress, poolId, userAction.chain);
    } catch (error) {
        console.error('Error processing pool incentives:', error);
        await ctx.reply('Error processing request. Please try again.');
    }
}

async function ibcId(ctx, ibcHash, chain) {
    const chainInfoResult = await chainInfo(ctx, chain);
    if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        ctx.reply('Error: REST address not found for the selected chain.');
        return;
    }

    let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
    const url = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcHash}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.denom_trace) {
            ctx.reply(`IBC Denom Trace: \n${JSON.stringify(data.denom_trace, null, 2)}`);
            return data.denom_trace.base_denom; // Optionally return the base denom for further processing
        } else {
            ctx.reply('No IBC Denom Trace found.');
        }
    } catch (error) {
        console.error('Error fetching IBC denom trace:', error);
        ctx.reply('Error fetching IBC denom trace. Please try again.');
    }
}

module.exports = {
    chainInfo,
    chainEndpoints,
    chainPeerNodes,
    chainBlockExplorers,
    poolInfo,
    poolIncentives,
    ibcId
};
