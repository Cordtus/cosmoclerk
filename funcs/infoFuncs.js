// infoFuncs.js

async function preprocessAndFormatIncentives(ctx, incentivesData, chain) {
    for (const incentive of incentivesData.data) {
        for (const coin of incentive.coins) {
            if (coin.denom.startsWith('ibc/')) {
                const ibcId = coin.denom.split('/')[1];
                // Assuming queryIbcId has been adjusted to return data when needed
                try {
                    const baseDenom = await ibcId(ctx, ibcId, chain, true); // Use the modified version
                    coin.denom = baseDenom || coin.denom;
                } catch (error) {
                    console.error('Error translating IBC denom:', coin.denom, error);
                }
            }
        }
    }

    // Now that all IBC denominations have been translated, format the response.
    return formatPoolIncentivesResponse(incentivesData);
}

// When an endpoint recovers, remove it from the unhealthy set
function recoverEndpoint(endpoint) {
    unhealthyEndpoints.delete(endpoint);
}

function sanitizeUrl(url) {
    // Escape special MarkdownV2 characters
    return url.replace(/[()]/g, '\\$&'); // Add more characters if needed
}

function formatPoolIncentivesResponse(data) {
    if (!data.data || data.data.length === 0) {
        return 'No incentives data available.';
    }

    let response = '';
    const currentDate = new Date(); // Get the current date

    const filteredAndSortedData = data.data
        .filter(incentive => {
            const startTime = new Date(incentive.start_time);
            const durationDays = parseInt(incentive.num_epochs_paid_over, 10);
            const endTime = new Date(startTime.getTime() + durationDays * 24 * 60 * 60 * 1000); // Calculate end time

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
        const remainingDays = durationDays - daysPassed > 0 ? durationDays - daysPassed : 0; // Ensure remaining days is not negative

        response += `Start Time: ${startTime.toLocaleDateString()}\n`;
        response += `Duration: ${durationDays} days\n`;
        response += `Remaining Days: ${remainingDays}\n`; // Add remaining days to the response
        response += `Coin: ${incentive.coins.map(coin => `${coin.denom}\nAmount: ${coin.amount}`).join('\n')}\n\n`;
    });

    return response;
}
