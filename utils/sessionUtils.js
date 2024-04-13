const config = require('../config');

let userLastAction = {};
const expectedAction = {};

function updateUserLastAction(userId, data) {
    userId = userId.toString();
    if (data !== null) {
        if (!userLastAction[userId]) {
            userLastAction[userId] = {}; // Initialize if not already present
        }
        // Update or set the user's last action and timestamp
        userLastAction[userId] = {
            ...userLastAction[userId],
            ...data,
            timestamp: new Date()
        };
    } else {
        // If data is null, delete last action to reset
        delete userLastAction[userId];
    }
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
        // check if session expired as per config threshold
        if (now - new Date(session.timestamp) > config.sessionExpirationThreshold) {
            delete userLastAction[userId];
            delete expectedAction[userId];
        }
    });
}

// run cleanup as per config interval
setInterval(cleanupExpiredSessions, config.cleanupInterval);

module.exports = {
    userLastAction,
    expectedAction,
    updateUserLastAction,
    updateExpectedAction
};
