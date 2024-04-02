// chainUtils.js

const fs = require('fs');
const path = require('path');
const { userLastAction, updateUserLastAction, expectedAction } = require('./sessionUtils'); // Include other necessary exports if used within
const fetch = require('node-fetch');
const { readFileSafely } = require('./repoUtils'); // Make sure the path is correct
const { isEndpointHealthy } = require('./coreUtils'); // Make sure the path is correct
const config = require('../config'); // Make sure the path is correct

async function chainInfo(ctx, chain) {
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction.get(userId);
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);

        const assetListPath = path.join(directory, 'assetlist.json');
        const chainJsonPath = path.join(directory, 'chain.json');

        const assetData = readFileSafely(assetListPath);
        const chainData = readFileSafely(chainJsonPath);

        if (!assetData || !chainData) {
            // Handle missing or invalid data appropriately
            return `Error: Data file for ${chain} is missing or invalid. Please check the server logs for details.`;
        }

        const baseDenom = chainData.staking?.staking_tokens[0]?.denom || "Unknown";

        const nativeDenomExponent = assetData.assets[0]?.denom_units.slice(-1)[0];
        const decimals = nativeDenomExponent ? nativeDenomExponent.exponent : "Unknown";

            async function findHealthyEndpoint(endpoints, isRpc) {
                for (const endpoint of endpoints) {
                    const healthy = await isEndpointHealthy(endpoint.address, isRpc, ctx);

                    if (healthy) {
                        return endpoint.address;
                    }
                }
                return "Unknown"; // Return Unknown if no healthy endpoint found
            }

        // Use findHealthyEndpointOfType for RPC, REST, and GRPC
        const rpcAddress = await findHealthyEndpointOfType(chainData, 'rpc');
        const restAddress = await findHealthyEndpointOfType(chainData, 'rest');

        const grpcAddress = chainData.apis?.grpc?.find(api => api.address)?.address || "Unknown";

        // Function to prefer explorer based on first character, ignoring URL prefixes
        function findPreferredExplorer(explorers) {
            if (!explorers || explorers.length === 0) return null;

            // Strip common prefixes for comparison purposes
            function stripPrefixes(name) {
                return name.replace(/^(http:\/\/|https:\/\/)?(www\.)?/, '');
            }

            // Sort explorers by preference: 'c', 'm', then any
            const preferredOrder = ['c', 'm'];
            const sortedExplorers = explorers
                .map(explorer => {
                    return {
                        kind: explorer.kind,
                        url: explorer.url,
                        compareUrl: stripPrefixes(explorer.url)
                    };
                })
                .sort((a, b) => {
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

       const blockExplorerUrl = findPreferredExplorer(chainData.explorers) || "Unknown";

        const message = `Chain ID: \`${chainData.chain_id}\`\n` +
            `Chain Name: \`${chainData.chain_name}\`\n` +
            `RPC: \`${rpcAddress}\`\n` +
            `REST: \`${restAddress}\`\n` +
            `Address Prefix: \`${chainData.bech32_prefix}\`\n` +
            `Base Denom: \`${baseDenom}\`\n` +
            `Cointype: \`${chainData.slip44}\`\n` +
            `Decimals: \`${decimals}\`\n` +
            `Block Explorer: \`${blockExplorerUrl}\``;

        // Return an object with both message and data
        return {
            message: message,
            data: {
                rpcAddress,
                restAddress,
                grpcAddress
            }
        };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching data for ${chain}: ${error.stack}`);
        return `Error fetching data for ${chain}: ${error.message}. Please contact the developer or open an issue on GitHub.`;
    }
}

async function chainEndpoints(ctx, chain) {
    console.log(`[${new Date().toISOString()}] Fetching endpoints for ${chain}`);
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction.get(userId);
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = readFileSafely(chainJsonPath);

        if (!chainData) {
            console.log(`Error: Data file for ${chain} is missing or invalid.`);
            await ctx.reply(`Error fetching endpoints for ${chain}. Data file is missing or invalid.`);
            return;
        }

        const formatService = (service) => {
            const provider = `*${service.provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_')}*`;
            const address = `\`${service.address.replace(/\/$/, '').replace(/_/g, '\\_')}\``;
            return `${provider}:\n${address}\n`;
        };

        const formatEndpoints = (services, title, maxEndpoints) => {
            if (!services || services.length === 0) {
                return `*${title}*\nNo data available\n`;
            }
            return services.slice(0, maxEndpoints).map(formatService).join("\n");
        };

        let responseSections = [
            `*RPC*\n---\n${formatEndpoints(chainData.apis.rpc, "RPC", 5)}`,
            `*REST*\n---\n${formatEndpoints(chainData.apis.rest, "REST", 5)}`,
            `*GRPC*\n---\n${formatEndpoints(chainData.apis.grpc, "GRPC", 5)}`
        ];

        if (chainData.apis['evm-http-jsonrpc']) {
            responseSections.push(`*EVM-HTTP-JSONRPC*\n---\n${formatEndpoints(chainData.apis['evm-http-jsonrpc'], "EVM-HTTP-JSONRPC", 5)}`);
        }

        let response = responseSections.filter(section => section !== "*RPC*\n---\nNo data available\n" && section !== "*REST*\n---\nNo data available\n" && section !== "*GRPC*\n---\nNo data available\n" && section !== "*EVM-HTTP-JSONRPC*\n---\nNo data available\n").join("\n\n").trim();

        console.log(`Response to be sent: ${response.substring(0, 50)}...`); // Log a preview of the response

        // Send the response, handle message length exceeding Telegram's limit if necessary
        if (response.length > 4096) {
            console.log('Response is too long, sending in parts.');
            // Define or use the splitIntoParts function here if necessary
        } else {
            await ctx.replyWithMarkdown(response);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching endpoints for ${chain}: ${error.message}`, error.stack);
        await ctx.reply(`Error fetching endpoints for ${chain}. Please try again.`);
    }
}

async function chainPeerNodes(ctx, chain) {
    try {
    const userId = ctx.from.id;
    const userAction = userLastAction.get(userId);
    const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
    const chainJsonPath = path.join(directory, 'chain.json');
    const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const sanitizeProvider = (provider) => {
            if (!provider) return 'unnamed';
            // Remove special characters and replace periods with underscores
            return provider.replace(/[^\w\s.-]/g, '').replace(/\./g, '_');
        };

        const formatPeers = (peers, title) => {
            if (!peers || peers.length === 0) return `*${title}*\nNo data available\n\n`;
            const formattedPeers = peers.map(peer => {
                const provider = `*${sanitizeProvider(peer.provider)}*`;
                const id = peer.id ? `id: \`${peer.id}\`` : 'id: unavailable';
                const address = peer.address ? `URL: \`${peer.address}\`` : 'URL: unavailable';
                return `\n${provider}:\n ${id}\n ${address}`;
            }).join("\n");
           return `*${title}*\n${'-'.repeat(title.length)}\n${formattedPeers}\n\n`;

        };

        const seedsHeader = "Seed Nodes";
        const peersHeader = "Peer Nodes";
        const seeds = formatPeers(chainData.peers.seeds, seedsHeader);
        const persistentPeers = formatPeers(chainData.peers.persistent_peers, peersHeader);

        return `${seeds}${persistentPeers}`;
    } catch (error) {
        console.log(`Error fetching peer nodes for ${chain}:`, error.message);
        return `Error fetching peer nodes for ${chain}. Please contact developer...`;
    }
}

async function chainBlockExplorers(ctx, chain) {
    try {
        const userId = ctx.from.id;
        const userAction = userLastAction.get(userId);
        const directory = userAction.browsingTestnets ? path.join(REPO_DIR, 'testnets', chain) : path.join(REPO_DIR, chain);
        const chainJsonPath = path.join(directory, 'chain.json');
        const chainData = JSON.parse(fs.readFileSync(chainJsonPath, 'utf8'));

        const explorersList = chainData.explorers
            .map(explorer => {
        const name = `*${explorer.kind.replace(/[^\w\s.-]/g, '').replace(/\./g, '_')}*`;
        // Enclose address in backticks and escape underscores
        const url = `\`${explorer.url.replace(/\/$/, '').replace(/_/g, '\\_')}\``;
        return `${name}:\n${url}\n`;
            })
            .join('\n');
        return explorersList;
    } catch (error) {
        console.log(`Error fetching block explorers for ${chain}:`, error.message);
        return `Error fetching block explorers for ${chain}. Please contact developer or open an issue on Github.`;
    }
}

/// Modify queryIbcId to allow for a returnable response or direct reply based on `returnBaseDenom`
async function queryIbcId(ctx, ibcId, chain, returnBaseDenom = false) {
    let restAddress = chainInfoResult.data.restAddress.replace(/\/+$/, '');
    const chainInfoResult = await chainInfo(ctx, chain);
    if (!chainInfoResult || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        if (returnBaseDenom) return ''; // Return empty string for further processing
        ctx.reply('Error: REST address not found for the selected chain.');
        return;
    }


    const url = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcId}`;
    try {
        const response = await fetch(url);
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

async function handlePoolIncentives(ctx, poolId) {

    const userAction = userLastAction[ctx.from.id];
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
        const poolTypeUrl = `${restAddress}/osmosis/gamm/v1beta1/pools/${poolId}`;
        const poolTypeResponse = await fetch(poolTypeUrl);

        if (!poolTypeResponse.ok) {
            ctx.reply('Error fetching pool type information. Please try again.');
            return;
        }

        const poolTypeData = await poolTypeResponse.json();
        const poolType = poolTypeData.pool["@type"];


    if (poolType.includes("/osmosis.gamm.v1beta1.Pool") || poolType.includes("/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool")) {
        try {
            const response = await fetch(`http://jasbanza.dedicated.co.za:7000/pool/${poolId}`);
            const rawData = await response.text();
            const jsonMatch = rawData.match(/<pre>([\s\S]*?)<\/pre>/);

            if (!jsonMatch || jsonMatch.length < 2) {
                throw new Error("No valid JSON found in the server's response.");
            }

            const jsonString = jsonMatch[1];
            let data = JSON.parse(jsonString);

            // Assume data.data contains the incentives with coins needing potential translation
            for (const incentive of data.data) {
                for (const coin of incentive.coins) {
                    if (coin.denom.startsWith('ibc/')) {
                        const ibcId = coin.denom.split('/')[1];
                        // Use the modified queryIbcId to get the base denomination
                        const baseDenom = await queryIbcId(ctx, ibcId, userAction.chain, true);
                        coin.denom = baseDenom || coin.denom; // Replace with the base denom if fetched
                    }
                }
            }

            // Now that all IBC denominations have been translated, format and reply with the updated incentives data
            const formattedResponse = formatPoolIncentivesResponse(data);
            ctx.reply(formattedResponse);

        } catch (error) {
            console.error('Error processing pool incentives data:', error);
            ctx.reply('Error processing pool incentives data. Please try again.');
        }
        } else if (poolType.includes("/osmosis.concentratedliquidity.v1beta1.Pool")) {
            const url = `${restAddress}/osmosis/concentratedliquidity/v1beta1/incentive_records?pool_id=${poolId}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to fetch incentive records');
            }
            const data = await response.json();

            if (data.incentive_records && data.incentive_records.length > 0) {
                const incentivesPromises = data.incentive_records.map(async (record) => {
                    const { incentive_id, incentive_record_body: { remaining_coin, emission_rate, start_time } } = record;
                    let denom = remaining_coin.denom;
                    if (denom.startsWith('ibc/')) {
                        const ibcId = denom.split('/')[1];
                        const ibcDenomUrl = `${restAddress}/ibc/apps/transfer/v1/denom_traces/${ibcId}`;
                        try {
                            const ibcResponse = await fetch(ibcDenomUrl);
                            const ibcData = await ibcResponse.json();
                            denom = ibcData.denom_trace ? ibcData.denom_trace.base_denom : denom;
                        } catch (error) {
                            console.error('Error fetching IBC denom trace:', error);
                        }
                    }

            // Calculate time remaining until the next epoch
            const epochStartTime = new Date(start_time);
            const nextEpoch = new Date(epochStartTime);
            nextEpoch.setUTCDate(epochStartTime.getUTCDate() + 1); // Next day
            nextEpoch.setUTCHours(17, 16, 12); // Time of the epoch

            const now = new Date();
            let time_remaining = (nextEpoch - now) / 1000; // Convert to seconds
            if (time_remaining < 0) {
            // If the current time is past today's epoch, calculate for the next day's epoch
            nextEpoch.setUTCDate(nextEpoch.getUTCDate() + 1);
            time_remaining = (nextEpoch - now) / 1000;
        }

            // Convert time_remaining to a more readable format if necessary
            const hours = Math.floor(time_remaining / 3600);
            const minutes = Math.floor((time_remaining % 3600) / 60);
            const seconds = Math.floor(time_remaining % 60);
            const timeRemainingFormatted = `${hours}h ${minutes}m ${seconds}s`;

            // Truncate the "amount_remaining" to remove numbers after the decimal
            const amountRemainingTruncated = Math.floor(Number(remaining_coin.amount));
            // Assuming emission_rate is a simple string that represents a number
            const emissionRateTruncated = Math.floor(Number(emission_rate));

                    return {
                        incentive_id,
                        denom, // Now possibly translated
                        amount_remaining: Math.floor(Number(remaining_coin.amount)).toString(),
                        emission_rate: Math.floor(Number(emission_rate)).toString(),
                        time_remaining: timeRemainingFormatted,
                    };
                });

                const incentives = await Promise.all(incentivesPromises);
                ctx.reply(JSON.stringify(incentives, null, 2));
            } else {
                ctx.reply('No incentives found.');
            }
        } else {
            ctx.reply('Unsupported pool type or no incentives available for this pool type.');
        }
    } catch (error) {
        console.error('Error processing pool incentives:', error);
        ctx.reply('Error processing request. Please try again.');
    }
}

module.exports = { chainInfo, chainEndpoints, chainPeerNodes, chainBlockExplorers, queryIbcId, handlePoolIncentives };
