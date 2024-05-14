const { sessionExpirationThreshold, cleanupInterval } = require('../config');

let userLastAction = {};
const expectedAction = {};
let healthyEndpointsCache = {};

function updateUserLastAction(userId, data) {
    userId = userId.toString();
    const session = userLastAction[userId];
    console.log(`Updating session for userId: ${userId}`);
    if (data !== null) {
        userLastAction[userId] = { ...session, ...data, timestamp: new Date() };
        console.log(`Session updated: ${JSON.stringify(userLastAction[userId])}`);
    } else {
        console.log(`Resetting session for userId: ${userId}`);
        delete userLastAction[userId];
    }
}

function getUserLastAction(userId) {
    userId = userId.toString();
    console.log(`Retrieving last action for userId: ${userId}`);
    return userLastAction[userId];
}

function updateExpectedAction(userId, action) {
    userId = userId.toString();
    console.log(`Updating expected action for userId: ${userId} to ${action}`);
    if (action !== null) {
        expectedAction[userId] = action;
    } else {
        delete expectedAction[userId];
    }
}

function cleanupExpiredSessions() {
    const now = new Date();
    console.log(`Running session cleanup at ${now.toISOString()}`);
    for (const userId in userLastAction) {
        const session = userLastAction[userId];
        if (session && (now - new Date(session.timestamp) > sessionExpirationThreshold)) {
            console.log(`Cleaning up expired session for userId: ${userId}`);
            delete userLastAction[userId];
            delete expectedAction[userId];
        }
    }
}

function safeCleanup() {
    try {
        cleanupExpiredSessions();
    } catch (error) {
        console.error('Failed to clean up sessions:', error);
    }
}

setInterval(safeCleanup, cleanupInterval);

function getHealthyEndpoints(chain) {
    const cacheEntry = healthyEndpointsCache[chain];
    if (cacheEntry && (new Date() - new Date(cacheEntry.timestamp) <= cleanupInterval)) {
        return cacheEntry.endpoints;
    }
    return null;
}

function setHealthyEndpoints(chain, endpoints) {
    healthyEndpointsCache[chain] = {
        endpoints,
        timestamp: new Date()
    };
}

function clearUserSession(userId) {
    userId = userId.toString();
    delete userLastAction[userId];
    delete expectedAction[userId];
}

module.exports = {
    updateUserLastAction,
    getUserLastAction,
    updateExpectedAction,
    userLastAction,
    expectedAction,
    getHealthyEndpoints,
    setHealthyEndpoints,
    clearUserSession
};
