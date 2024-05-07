// sessionUtils.js

const config = require('../config');

let userLastAction = {};
const expectedAction = {};

function updateUserLastAction(userId, data) {
    userId = userId.toString();
    if (data !== null) {
        // Initialize if not already present
        if (!userLastAction[userId]) {
            userLastAction[userId] = {};
        }
        // Update the last action with new data and timestamp
        userLastAction[userId] = { ...userLastAction[userId], ...data, timestamp: new Date() };
    } else {
        // Reset the last action for the user
        delete userLastAction[userId];
    }
}

function getUserLastAction(userId) {
    userId = userId.toString();
    return userLastAction[userId];
}

function updateExpectedAction(userId, action) {
    userId = userId.toString();
    if (action !== null) {
        expectedAction[userId] = action;
    } else {
        delete expectedAction[userId];
    }
}

function cleanupExpiredSessions() {
    const now = new Date();
    Object.keys(userLastAction).forEach(userId => {
        const session = userLastAction[userId];
        if (session && (now - new Date(session.timestamp) > config.sessionExpirationThreshold)) {
            delete userLastAction[userId];
            delete expectedAction[userId];
        }
    });
}

setInterval(cleanupExpiredSessions, config.cleanupInterval);

module.exports = {
    updateUserLastAction,
    getUserLastAction,
    updateExpectedAction,
    userLastAction,
    expectedAction
};
