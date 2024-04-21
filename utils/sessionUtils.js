const config = require('../config');

// Stores last actions of each user
let userLastAction = {};

// Stores the expected next action of users
const expectedAction = {};

/**
 * Updates or resets the last action for a user.
 * @param {string} userId - The ID of the user.
 * @param {object|null} data - The data to update, or null to reset.
 */
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

/**
 * Updates the expected action for a user.
 * @param {string} userId - The ID of the user.
 * @param {string|null} action - The expected action, or null to reset.
 */
function updateExpectedAction(userId, action) {
    userId = userId.toString();
    if (action !== null) {
        expectedAction[userId] = action;
    } else {
        delete expectedAction[userId];
    }
}

/**
 * Cleans up expired sessions based on the session expiration threshold.
 */
function cleanupExpiredSessions() {
    const now = new Date();
    Object.keys(userLastAction).forEach(userId => {
        const session = userLastAction[userId];
        if (now - new Date(session.timestamp) > config.sessionExpirationThreshold) {
            delete userLastAction[userId];
            delete expectedAction[userId];
        }
    });
}

// Run cleanup periodically based on the configured interval
setInterval(cleanupExpiredSessions, config.cleanupInterval);

module.exports = {
    userLastAction,
    expectedAction,
    updateUserLastAction,
    updateExpectedAction
};
