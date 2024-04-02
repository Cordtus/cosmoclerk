// funcs/index.js

const { handlePriceInfo, handlePoolInfo } = require('./chainFuncs');
const {
    preprocessAndFormatIncentives,
    sanitizeUrl,
    formatPoolIncentivesResponse,
} = require('./infoFuncs');
const {
    sendMainMenu,
    handleMainMenuAction,
    editOrSendMessage,
    paginateChains,
    resetSessionAndShowChains,
    showTestnets,
} = require('./menuFuncs');

module.exports = {
    handlePriceInfo,
    handlePoolInfo,
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
