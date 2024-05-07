const { sessionExpirationThreshold, cleanupInterval } = require('./config');

let userLastAction = {};
const expectedAction = {};

function updateUserLastAction(userId, data) {
    userId = userId.toString();
    if (data !== null) {
        if (!userLastAction[userId]) {
            userLastAction[userId] = {};
        }
        userLastAction[userId] = { ...userLastAction[userId], ...data, timestamp: new Date() };
    } else {
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
        if (session && (now - new Date(session.timestamp) > sessionExpirationThreshold)) {
            delete userLastAction[userId];
            delete expectedAction[userId];
        }
    });
}

setInterval(cleanupExpiredSessions, cleanupInterval);

module.exports = {
    updateUserLastAction,
    getUserLastAction,
    updateExpectedAction
};
