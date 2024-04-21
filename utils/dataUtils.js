// dataUtils.js

async function handleChainInfo(ctx, userAction) {
    try {
        const chainInfoResult = await chainInfo(ctx, userAction.chain);
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
                    const baseDenom = await ibcId(ctx, ibcId, chain, true);
                    coin.denom = baseDenom || coin.denom;
                } catch (error) {
                    console.error('Error translating IBC denom:', coin.denom, error);
                    // Optionally handle the error by skipping this coin or using a default value
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

async function formatPoolInfo(ctx, poolData, chain) {
    if (!poolData || !poolData.pool) {
        console.error('Invalid pool data:', poolData);
        return 'Error: Pool data is not available or malformed.';
    }
    let formattedResponse = '';
    const poolType = poolData.pool["@type"];

    // Fetching the chain info
    const chainInfoResult = await chainInfo(ctx, chain);
    console.log('chainInfoResult:', chainInfoResult);

    // Check if chainInfoResult has the expected structure and contains necessary data
    if (!chainInfoResult || typeof chainInfoResult !== 'object' || !chainInfoResult.data || !chainInfoResult.data.restAddress) {
        console.error('chainInfoResult is not structured as expected or missing necessary data:', chainInfoResult);
        return 'Error: Failed to retrieve or validate chain information. Please check the server logs for details.';
    }

    try {
        if (poolType.includes("/osmosis.gamm.v1beta1.Pool") || poolType.includes("/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool")) {
            // Gamm pool formatting
            formattedResponse += `Pool Type: Gamm Pool\n`;
            formattedResponse += `ID: ${poolData.pool.id}\n`;
            formattedResponse += `Address: ${poolData.pool.address}\n`;
            formattedResponse += `Swap Fee: ${poolData.pool.pool_params.swap_fee}\n`;
            formattedResponse += `Exit Fee: ${poolData.pool.pool_params.exit_fee}\n`;

            for (const asset of poolData.pool.pool_assets) {
                const baseDenom = await queryIbcId(ctx, asset.token.denom.split('/')[1], chain, true);
                formattedResponse += `Token: ${baseDenom || asset.token.denom}\n`;
                formattedResponse += `[denom:\`${asset.token.denom}\`]\n`;
            }
        } else if (poolType.includes("/osmosis.concentratedliquidity.v1beta1.Pool")) {
            // Concentrated liquidity pool formatting
            formattedResponse += `Pool Type: Concentrated Liquidity Pool\n`;
            formattedResponse += `ID: ${poolData.pool.id}\n`;
            formattedResponse += `Address: ${poolData.pool.address}\n`;
            formattedResponse += `Swap Fee: ${poolData.pool.spread_factor}\n`;

            const tokens = [poolData.pool.token0, poolData.pool.token1];
            for (const token of tokens) {
                const baseDenom = await queryIbcId(ctx, token.split('/')[1], chain, true);
                formattedResponse += `Token: ${baseDenom || token}\n`;
            }
        } else if (poolType.includes("/osmosis.cosmwasmpool.v1beta1.CosmWasmPool")) {
            const contractAddress = poolData.pool.contract_address;

            // Correctly using chainInfoResult.data for the query
            const configResponse = await queryCosmWasmContract(ctx, chainInfoResult.data.restAddress, contractAddress, {"get_config": {}});
            const swapFeeResponse = await queryCosmWasmContract(ctx, chainInfoResult.data.restAddress, contractAddress, {"get_swap_fee": {}});
            const totalLiquidityResponse = await queryCosmWasmContract(ctx, chainInfoResult.data.restAddress, contractAddress, {"get_total_pool_liquidity": {}});


            // Constructing the formatted response
            formattedResponse += `Pool Type: CosmWasm Pool\nContract Address: ${contractAddress}\nSwap Fee: ${swapFeeResponse.swap_fee}\nConfig: ${JSON.stringify(configResponse)}\n`;
            totalLiquidityResponse.total_pool_liquidity.forEach(asset => {
                formattedResponse += `Token: ${asset.denom}\nAmount: ${asset.amount}\n`;
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
    handleChainInfo,
    denomTracePoolIncentives,
    formatPoolIncentivesResponse,
    formatPoolInfo,
};