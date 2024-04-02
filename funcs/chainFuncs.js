// chainFuncs.js

const fetch = require('node-fetch');
const { updateUserLastAction, userLastAction, expectedAction, chainInfo } = require('../utils');


async function handlePriceInfo(ctx, tokenTicker) {
    try {
        const priceInfoUrl = `https://api.osmosis.zone/tokens/v2/price/${tokenTicker}`;
        const response = await fetch(priceInfoUrl);
        if (!response.ok) {
            throw new Error('Error fetching price information.');
        }
        const priceData = await response.json();
        let formattedResponse = `Token: ${tokenTicker.toUpperCase()}\n`;
        formattedResponse += `Price: \`${priceData.price}\`\n`; // Formatting with backticks for monospace
        formattedResponse += `24h Change: \`${priceData['24h_change']}%\``; // Adding '%' for clarity
        await ctx.reply(formattedResponse, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error fetching price info:', error);
        await ctx.reply('Error fetching price information. Please try again.');
    }
}

async function handlePoolInfo(ctx, poolId) {
    const userAction = userLastAction[ctx.from.id];
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
        const formattedResponse = await formatPoolInfoResponse(ctx, poolData, userAction.chain);
        ctx.reply(formattedResponse);
    } catch (error) {
        console.error('Error fetching pool info:', error);
        ctx.reply('Error fetching pool information. Please try again.');
    }
}

module.exports = { handlePriceInfo, handlePoolInfo };
