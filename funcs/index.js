// funcs/index.js

const { preprocessAndFormatIncentives, sanitizeUrl, formatPoolIncentivesResponse } = require('./infoFuncs');
const { sendMainMenu, handleMainMenuAction, editOrSendMessage, paginateChains, resetSessionAndShowChains, showTestnets } = require('./menuFuncs');

module.exports = {
    preprocessAndFormatIncentives,
    sanitizeUrl,
    formatPoolIncentivesResponse,
    sendMainMenu,
    handleMainMenuAction,
    editOrSendMessage,
    paginateChains,
    resetSessionAndShowChains,
    showTestnets,
};
